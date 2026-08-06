import { db } from '../db'
import { recordAudit } from '../audit'
import { canMessage } from '../customer-groups'
import { whatsappUrl } from '../phone'
import { EXPENSE_CATEGORIES } from '../finance-categories'
import { LOG_PERIODS, AD_HOC_GROUP_KEY } from '../constants'
import { createAppointment } from '@/app/appointments/new/actions'
import { createExpense } from '@/app/finance/expenses/actions'
import { setReorderLevel } from '@/app/products/actions'
import { saveCareLog, type CareLogFields } from '@/app/runsheet/[id]/log/actions'
import { logSend } from '@/app/marketing/actions'

// ── C2 · Write tools behind a confirm gate ───────────────────────────────────
//
// The assistant stops answering and starts doing — but never unattended. A
// mutating tool returns a PROPOSAL and writes nothing. A human reads the
// preview, presses Confirm, and only then does the write happen, through the
// same server action the manual UI calls, with the same validation.
//
// Three properties this module exists to hold:
//
//   1. The model never touches the database. `propose()` writes one row, to
//      AiProposal, describing what it would like to do.
//   2. Execution goes through the manual path. Not a copy of it — the same
//      exported function the form submits to, so validation cannot drift apart
//      between the two callers.
//   3. The model works in NAMES, never ids. Resolution happens here, and an
//      ambiguous name is a refusal rather than a coin flip. "Book Luna in" with
//      two Lunas on the books must stop, not pick one.

/** The complete set of writes the assistant may propose. Anything not here is unreachable. */
export const PROPOSAL_KINDS = ['whatsapp', 'appointment', 'careNote', 'reorder', 'expense'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

/**
 * Permanently human-only. Not a configuration, not a phase-two list — these
 * move money, adjust balances people are owed, or destroy records, and a
 * confirm card is not a good enough gate for any of them. The verification
 * script asserts none of these is reachable; keep it that way.
 */
export const FORBIDDEN_WRITES = [
  'pos.checkout', 'transaction.delete', 'transaction.edit', 'loyalty.adjust',
  'wallet.adjust', 'payroll', 'commission', 'statement.cell', 'customer.erase',
] as const

/** A proposal older than this cannot be confirmed — "book her in for tomorrow" ages badly. */
export const PROPOSAL_TTL_MIN = 30

/**
 * Above this, an expense goes through the manual form. Not because the model is
 * more likely to be wrong about a large number, but because a wrong large one
 * distorts the income statement in a way nobody notices until month end, and a
 * confirm card is read far more quickly than a form is filled in.
 */
export const MAX_PROPOSED_EXPENSE_RM = 50000

export type Proposal =
  | { kind: 'whatsapp'; customerId: string; customerName: string; phone: string; body: string }
  | { kind: 'appointment'; customerId: string; catId: string; serviceId: string; startISO: string; endISO?: string; roomId?: string; notes?: string }
  | { kind: 'careNote'; appointmentId: string; date: string; period: string; fields: CareLogFields }
  | { kind: 'reorder'; productId: string; reorderLevel: number | null }
  | { kind: 'expense'; dateStr: string; category: string; amount: number; vendor?: string | null; notes?: string | null; paid: boolean }

type Built = { ok: true; proposal: Proposal; summary: string } | { ok: false; error: string }
type Args = Record<string, unknown>

const str = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 2 })}`
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── Name resolution ──────────────────────────────────────────────────────────
// One match proceeds; none or several refuse with a message the model can relay
// and the human can act on.

async function resolveCat(name: string) {
  const q = str(name, 60)
  if (!q) return { error: 'Which cat?' }
  const cats = await db.cat.findMany({
    where: { name: { contains: q }, customer: { erasedAt: null } },
    select: { id: true, name: true, customerId: true, customer: { select: { name: true, phone: true } } },
    take: 5,
  })
  if (cats.length === 0) return { error: `No cat matching "${q}".` }
  if (cats.length > 1) {
    return { error: `"${q}" matches ${cats.length} cats (${cats.map(c => `${c.name} · ${c.customer.name ?? c.customer.phone}`).join('; ')}). Be specific.` }
  }
  return { cat: cats[0] }
}

async function resolveCustomer(name: string) {
  const q = str(name, 60)
  if (!q) return { error: 'Which customer?' }
  const customers = await db.customer.findMany({
    where: { erasedAt: null, OR: [{ name: { contains: q } }, { phone: { contains: q } }] },
    select: { id: true, name: true, phone: true },
    take: 5,
  })
  if (customers.length === 0) return { error: `No customer matching "${q}".` }
  if (customers.length > 1) {
    return { error: `"${q}" matches ${customers.length} customers (${customers.map(c => c.name ?? c.phone).join('; ')}). Be specific.` }
  }
  return { customer: customers[0] }
}

// ── Building a proposal from what the model asked for ────────────────────────

async function buildWhatsapp(a: Args): Promise<Built> {
  const found = await resolveCustomer(str(a.customerName, 60))
  if (found.error) return { ok: false, error: found.error }
  const customer = found.customer!

  const body = str(a.body, 700)
  if (body.length < 5) return { ok: false, error: 'Write the message you want to send.' }

  // Consent and the frequency cap are checked now AND again on confirm — the
  // gap between proposing and pressing Confirm is long enough for a colleague
  // to have messaged the same person from the group worklist.
  const gate = await canMessage(customer.id)
  if (!gate.ok) return { ok: false, error: gate.reason }

  return {
    ok: true,
    proposal: { kind: 'whatsapp', customerId: customer.id, customerName: customer.name ?? customer.phone, phone: customer.phone, body },
    summary: `WhatsApp to ${customer.name ?? customer.phone}`,
  }
}

async function buildAppointment(a: Args): Promise<Built> {
  const found = await resolveCat(str(a.catName, 60))
  if (found.error) return { ok: false, error: found.error }
  const cat = found.cat!

  const serviceQ = str(a.serviceName, 60)
  const services = await db.service.findMany({
    where: { name: { contains: serviceQ }, active: true },
    select: { id: true, name: true, category: true, price: true, durationMin: true },
    take: 5,
  })
  if (services.length === 0) return { ok: false, error: `No active service matching "${serviceQ}".` }
  if (services.length > 1) return { ok: false, error: `"${serviceQ}" matches ${services.map(s => s.name).join('; ')}. Name one.` }
  const service = services[0]

  const start = new Date(str(a.startISO, 40))
  if (isNaN(start.getTime())) return { ok: false, error: 'Give a start time as an ISO datetime.' }
  if (start.getTime() < Date.now() - 60 * 60 * 1000) return { ok: false, error: 'That start time is in the past.' }

  const endRaw = str(a.endISO, 40)
  const end = endRaw ? new Date(endRaw) : null
  if (endRaw && (!end || isNaN(end.getTime()))) return { ok: false, error: 'Give the check-out as an ISO datetime.' }

  let roomId: string | undefined
  const roomQ = str(a.roomName, 40)
  if (roomQ) {
    const room = await db.room.findFirst({ where: { name: roomQ, isActive: true }, select: { id: true } })
    if (!room) return { ok: false, error: `No active room called "${roomQ}".` }
    roomId = room.id
  }

  const when = start.toLocaleString('en-MY', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return {
    ok: true,
    proposal: {
      kind: 'appointment',
      customerId: cat.customerId, catId: cat.id, serviceId: service.id,
      startISO: start.toISOString(), endISO: end?.toISOString(), roomId,
      notes: str(a.notes, 200) || undefined,
    },
    // No deposit: money taken is a POS concern, and rule 3 (every POS side
    // effect needs a reversal) is not something to hang off a confirm card.
    summary: `${service.name} for ${cat.name} · ${when}${end ? ` → ${end.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}` : ''}`,
  }
}

async function buildCareNote(a: Args): Promise<Built> {
  const found = await resolveCat(str(a.catName, 60))
  if (found.error) return { ok: false, error: found.error }
  const cat = found.cat!

  const stay = await db.appointment.findFirst({
    where: { catId: cat.id, type: 'Boarding', status: 'CheckedIn' },
    orderBy: { scheduledAt: 'desc' },
    select: { id: true },
  })
  if (!stay) return { ok: false, error: `${cat.name} is not currently boarding.` }

  const period = str(a.period, 4).toUpperCase()
  if (!(LOG_PERIODS as readonly string[]).includes(period)) return { ok: false, error: 'Period must be AM or PM.' }

  const behavior = Array.isArray(a.behavior) ? a.behavior.map(b => str(b, 40)).filter(Boolean) : []
  const fields: CareLogFields = {
    appetite: str(a.appetite, 40) || null,
    stool: str(a.stool, 40) || null,
    urine: str(a.urine, 40) || null,
    energy: str(a.energy, 40) || null,
    respiratory: str(a.respiratory, 40) || null,
    skin: str(a.skin, 40) || null,
    behavior,
    vomiting: a.vomiting === true,
    notes: str(a.notes, 400) || null,
  }

  const filled = Object.entries(fields).filter(([k, v]) => k !== 'vomiting' && (Array.isArray(v) ? v.length : v)).length
  if (filled === 0 && !fields.vomiting) return { ok: false, error: 'Nothing to log — give at least one observation.' }

  return {
    ok: true,
    proposal: { kind: 'careNote', appointmentId: stay.id, date: dayKey(new Date()), period, fields },
    summary: `${period} care log for ${cat.name}`,
  }
}

async function buildReorder(a: Args): Promise<Built> {
  const q = str(a.productName, 80)
  const products = await db.product.findMany({
    where: { name: { contains: q }, active: true },
    select: { id: true, name: true, stockQty: true, reorderLevel: true },
    take: 5,
  })
  if (products.length === 0) return { ok: false, error: `No active product matching "${q}".` }
  if (products.length > 1) return { ok: false, error: `"${q}" matches ${products.map(p => p.name).join('; ')}. Name one.` }
  const product = products[0]

  const raw = a.reorderLevel
  const level = raw == null || raw === '' ? null : Math.max(0, Math.floor(Number(raw)))
  if (level != null && !Number.isFinite(level)) return { ok: false, error: 'Reorder level must be a whole number.' }

  return {
    ok: true,
    proposal: { kind: 'reorder', productId: product.id, reorderLevel: level },
    summary: `${product.name} · reorder at ${level ?? 'no alert'} (was ${product.reorderLevel ?? 'no alert'}, ${product.stockQty} in stock)`,
  }
}

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES)

async function buildExpense(a: Args): Promise<Built> {
  const category = str(a.category, 60)
  if (!CATEGORY_SET.has(category)) {
    return { ok: false, error: `"${category}" is not an expense category. Use one of: ${EXPENSE_CATEGORIES.join(', ')}.` }
  }

  const amount = Math.round(Number(a.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Amount must be more than zero.' }
  if (amount > MAX_PROPOSED_EXPENSE_RM) {
    return { ok: false, error: `${rm(amount)} is above the ${rm(MAX_PROPOSED_EXPENSE_RM)} ceiling for a drafted expense — record it on the Expenses page.` }
  }

  const dateStr = str(a.dateStr, 10) || dayKey(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: 'Date must be YYYY-MM-DD.' }

  const vendor = str(a.vendor, 80) || null
  const paid = a.paid !== false
  return {
    ok: true,
    proposal: { kind: 'expense', dateStr, category, amount, vendor, notes: str(a.notes, 200) || null, paid },
    summary: `${category} ${rm(amount)}${vendor ? ` · ${vendor}` : ''} · ${dateStr}${paid ? '' : ' · unpaid'}`,
  }
}

const BUILDERS: Record<ProposalKind, (a: Args) => Promise<Built>> = {
  whatsapp: buildWhatsapp,
  appointment: buildAppointment,
  careNote: buildCareNote,
  reorder: buildReorder,
  expense: buildExpense,
}

// ── Propose ──────────────────────────────────────────────────────────────────

export type ProposeResult =
  | { ok: true; id: string; kind: ProposalKind; summary: string }
  | { ok: false; error: string }

/** Validate what the model asked for and park it. Writes nothing but the proposal itself. */
export async function propose(kind: string, args: Args, prompt: string): Promise<ProposeResult> {
  const builder = (PROPOSAL_KINDS as readonly string[]).includes(kind) ? BUILDERS[kind as ProposalKind] : null
  if (!builder) return { ok: false, error: `"${kind}" is not something I can do.` }

  const built = await builder(args)
  if (!built.ok) return { ok: false, error: built.error }

  const row = await db.aiProposal.create({
    data: {
      kind,
      payload: JSON.stringify(built.proposal),
      summary: built.summary,
      prompt: prompt.slice(0, 500),
    },
  })
  return { ok: true, id: row.id, kind: kind as ProposalKind, summary: built.summary }
}

export interface PendingProposal {
  id: string
  kind: ProposalKind
  summary: string
  detail: string[] // the lines the confirm card shows, so a human reads the real content
}

/** Re-read stored proposals for display. The client is shown what was SAVED, never what it posted. */
export async function loadProposals(ids: string[]): Promise<PendingProposal[]> {
  if (ids.length === 0) return []
  const rows = await db.aiProposal.findMany({ where: { id: { in: ids }, status: 'Pending' } })
  return rows.map(r => ({
    id: r.id,
    kind: r.kind as ProposalKind,
    summary: r.summary,
    detail: detailLines(JSON.parse(r.payload) as Proposal),
  }))
}

function detailLines(p: Proposal): string[] {
  switch (p.kind) {
    case 'whatsapp': return [p.body]
    case 'appointment': return [p.notes ?? ''].filter(Boolean)
    case 'careNote': {
      const f = p.fields
      const parts = [
        f.appetite && `Appetite: ${f.appetite}`, f.stool && `Stool: ${f.stool}`,
        f.urine && `Urine: ${f.urine}`, f.energy && `Energy: ${f.energy}`,
        f.respiratory && `Respiratory: ${f.respiratory}`, f.skin && `Skin: ${f.skin}`,
        f.behavior?.length ? `Behaviour: ${f.behavior.join(', ')}` : '',
        f.vomiting ? 'Vomiting: yes' : '',
      ].filter(Boolean) as string[]
      if (f.notes) parts.push(f.notes)
      return parts
    }
    case 'reorder': return []
    case 'expense': return [p.notes ?? ''].filter(Boolean)
  }
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export type ConfirmResult =
  | { ok: true; kind: ProposalKind; summary: string; message: string; link?: string }
  | { ok: false; error: string }

/**
 * Execute a proposal, once. The status claim is an atomic conditional update, so
 * a double-clicked Confirm produces one appointment rather than two — the whole
 * reason the proposal is stored server-side instead of round-tripped.
 */
export async function confirmProposal(id: string, now: Date = new Date()): Promise<ConfirmResult> {
  const row = await db.aiProposal.findUnique({ where: { id } })
  if (!row) return { ok: false, error: 'That suggestion is gone.' }
  if (row.status !== 'Pending') return { ok: false, error: 'That suggestion has already been dealt with.' }
  if (now.getTime() - row.createdAt.getTime() > PROPOSAL_TTL_MIN * 60 * 1000) {
    await db.aiProposal.updateMany({ where: { id, status: 'Pending' }, data: { status: 'Declined', decidedAt: now, error: 'expired' } })
    return { ok: false, error: 'That suggestion is too old to act on — ask again.' }
  }

  const claim = await db.aiProposal.updateMany({
    where: { id, status: 'Pending' },
    data: { status: 'Confirmed', decidedAt: now },
  })
  if (claim.count === 0) return { ok: false, error: 'That suggestion has already been dealt with.' }

  const proposal = JSON.parse(row.payload) as Proposal
  let outcome: { ok: true; id: string } | { ok: false; error: string }
  let link: string | undefined

  try {
    switch (proposal.kind) {
      case 'whatsapp': {
        // Re-gated: consent may have been withdrawn, or the cap consumed by a
        // colleague, in the minutes since this was drafted.
        outcome = await logSend(proposal.customerId, AD_HOC_GROUP_KEY)
        if (outcome.ok) link = whatsappUrl(proposal.phone, proposal.body)
        break
      }
      case 'appointment': {
        const r = await createAppointment(JSON.stringify({
          lane: proposal.endISO ? 'boarding' : 'grooming',
          customerId: proposal.customerId, catId: proposal.catId, serviceId: proposal.serviceId,
          startISO: proposal.startISO, endISO: proposal.endISO, roomId: proposal.roomId, notes: proposal.notes,
        }))
        outcome = r
        break
      }
      case 'careNote':
        outcome = await saveCareLog(proposal.appointmentId, proposal.date, proposal.period, proposal.fields)
        break
      case 'reorder':
        outcome = await setReorderLevel(proposal.productId, proposal.reorderLevel)
        break
      case 'expense':
        outcome = await createExpense({
          dateStr: proposal.dateStr, category: proposal.category, amount: proposal.amount,
          vendor: proposal.vendor, notes: proposal.notes, paid: proposal.paid,
        })
        break
    }
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (!outcome.ok) {
    // Marked Declined rather than returned to Pending: from here a retry and a
    // duplicate are indistinguishable, and one of those is much worse.
    await db.aiProposal.update({ where: { id }, data: { status: 'Declined', error: outcome.error } })
    return { ok: false, error: outcome.error }
  }

  await db.aiProposal.update({ where: { id }, data: { resultId: outcome.id } })
  await recordAudit({
    action: `copilot.${proposal.kind}`,
    entityType: ENTITY[proposal.kind],
    entityId: outcome.id,
    summary: `Confirmed AI suggestion — ${row.summary}`,
    detail: { prompt: row.prompt, kind: proposal.kind, payload: proposal, proposalId: id },
  })

  return { ok: true, kind: proposal.kind, summary: row.summary, message: DONE[proposal.kind], link }
}

export async function declineProposal(id: string): Promise<void> {
  await db.aiProposal.updateMany({
    where: { id, status: 'Pending' },
    data: { status: 'Declined', decidedAt: new Date() },
  })
}

const ENTITY: Record<ProposalKind, string> = {
  whatsapp: 'GroupSend', appointment: 'Appointment', careNote: 'DailyCareLog',
  reorder: 'Product', expense: 'Expense',
}
const DONE: Record<ProposalKind, string> = {
  whatsapp: 'Logged as sent — open WhatsApp to send it.',
  appointment: 'Booked.',
  careNote: 'Logged.',
  reorder: 'Reorder level updated.',
  expense: 'Expense recorded.',
}
