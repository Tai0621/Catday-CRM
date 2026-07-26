import { db } from './db'

// Shared model + loaders for the digital receipt, used by both the staff-facing
// receipt page (/pos/receipt/[id]) and the public customer link (/r/[token]).

export type ReceiptLine = { id: string; description: string; quantity: number; subtotal: number }
export type ReceiptView = {
  id: string
  reference: string | null
  token: string
  date: Date
  customer: { name: string | null; phone: string } | null
  lines: ReceiptLine[]
  grandTotal: number
  payments: { method: string; amount: number }[]
  points: number | null
  sentAt: Date | null
  channel: string | null
}

function newToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

type TxnWithLines = NonNullable<Awaited<ReturnType<typeof loadPrimary>>>
function loadPrimary(where: { id: string } | { publicToken: string }) {
  return db.transaction.findUnique({ where, include: { customer: true, lines: true } })
}

async function toView(primary: TxnWithLines): Promise<ReceiptView> {
  // A split payment (e.g. wallet + card) spreads across sibling rows sharing
  // one reference — sum them for the true total and list each payment method.
  const siblings = primary.reference
    ? await db.transaction.findMany({ where: { reference: primary.reference, id: { not: primary.id } } })
    : []
  const grandTotal = Math.round((primary.total + siblings.reduce((s, t) => s + t.total, 0)) * 100) / 100
  const payments = [primary, ...siblings]
    .map(t => ({ method: t.method ?? '—', amount: t.total }))
    .filter(p => p.amount > 0)
  const pts = primary.customerId && primary.reference
    ? await db.loyaltyEntry.findFirst({ where: { customerId: primary.customerId, note: primary.reference } })
    : null

  return {
    id: primary.id,
    reference: primary.reference,
    token: primary.publicToken!, // callers ensure this is set before rendering a link
    date: primary.date,
    customer: primary.customer ? { name: primary.customer.name, phone: primary.customer.phone } : null,
    lines: primary.lines.map(l => ({ id: l.id, description: l.description, quantity: l.quantity, subtotal: l.subtotal })),
    grandTotal,
    payments,
    points: pts?.points ?? null,
    sentAt: primary.receiptSentAt ?? null,
    channel: primary.receiptChannel ?? null,
  }
}

// Staff view: loads by transaction id and lazily mints a public token for
// pre-Round-7 sales so any past receipt can still be shared.
export async function getReceiptById(id: string): Promise<ReceiptView | null> {
  const primary = await loadPrimary({ id })
  if (!primary) return null
  if (!primary.publicToken) {
    const token = newToken()
    await db.transaction.update({ where: { id }, data: { publicToken: token } })
    primary.publicToken = token
  }
  return toView(primary)
}

// Public view: strictly by unguessable token (no auth).
export async function getReceiptByToken(token: string): Promise<ReceiptView | null> {
  const primary = await loadPrimary({ publicToken: token })
  if (!primary) return null
  return toView(primary)
}

export function generateReceiptToken(): string {
  return newToken()
}

export function receiptWhatsappText(v: ReceiptView, businessName: string, url: string): string {
  return [
    `Thank you for visiting ${businessName}! 🐾`,
    `Receipt ${v.reference ?? v.id}`,
    ...v.lines.map(l => `· ${l.description}${l.quantity > 1 ? ` ×${l.quantity}` : ''} — RM ${l.subtotal.toFixed(2)}`),
    `Total: RM ${v.grandTotal.toFixed(2)}`,
    v.points ? `Points earned: ${v.points} 🌟` : '',
    `View your receipt: ${url}`,
    `See you and your cat again soon!`,
  ].filter(Boolean).join('\n')
}
