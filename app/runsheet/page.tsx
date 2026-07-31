import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { careTasksForStay, logRedFlags } from '@/lib/care-log'
import { boardingHealthGate } from '@/lib/health'
import { SEGMENTS } from '@/lib/segments'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { getConfig } from '@/lib/config'

const DAY = 24 * 60 * 60 * 1000
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The boarding run sheet: a generated daily checklist for every occupied room,
// built from each cat's own care notes. Ticking is the work record.
export default async function RunSheetPage() {
  const session = await requireAuth()
  const { business } = await getConfig()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)
  const today = dateKey(now)

  // Occupied stays = checked-in boarding whose window covers today
  const stays = await db.appointment.findMany({
    where: {
      type: 'Boarding',
      status: 'CheckedIn',
      scheduledAt: { lt: todayEnd },
      OR: [{ endsAt: { gte: todayStart } }, { endsAt: null }],
    },
    include: { cat: true, customer: true, room: true },
    orderBy: { room: { sortOrder: 'asc' } },
  })

  // Today's arrivals still waiting to be checked in
  const arrivals = await db.appointment.findMany({
    where: { type: 'Boarding', status: 'Scheduled', scheduledAt: { gte: todayStart, lt: todayEnd } },
    include: { cat: true, customer: true, room: true },
    orderBy: { scheduledAt: 'asc' },
  })

  // Ensure today's tasks exist for each stay (idempotent)
  const existing = await db.careTask.findMany({ where: { date: today } })
  const have = new Set(existing.map(t => `${t.appointmentId}|${t.task}`))
  const toCreate: { date: string; appointmentId: string; catId: string; task: string }[] = []
  for (const s of stays) {
    const nights = Math.floor((todayStart.getTime() - s.scheduledAt.getTime()) / DAY)
    const checkoutToday = !!s.endsAt && s.endsAt < todayEnd
    const fullLitterDue = checkoutToday || (nights > 0 && nights % 7 === 0) // weekly or on checkout (S003)
    for (const task of careTasksForStay(s.cat, { fullLitterDue })) {
      if (!have.has(`${s.id}|${task}`)) toCreate.push({ date: today, appointmentId: s.id, catId: s.catId, task })
    }
  }
  if (toCreate.length > 0) {
    for (const t of toCreate) {
      await db.careTask.create({ data: t }).catch(() => {}) // unique race — fine
    }
  }
  const tasks = await db.careTask.findMany({ where: { date: today }, orderBy: { createdAt: 'asc' } })
  const byStay = new Map<string, typeof tasks>()
  for (const t of tasks) {
    if (!byStay.has(t.appointmentId)) byStay.set(t.appointmentId, [])
    byStay.get(t.appointmentId)!.push(t)
  }

  // Today's AM/PM structured logs, by stay — drives the log buttons + red flags.
  const todayLogs = await db.dailyCareLog.findMany({ where: { appointmentId: { in: stays.map(s => s.id) }, date: today } })
  const logByStay = new Map<string, { AM?: (typeof todayLogs)[number]; PM?: (typeof todayLogs)[number] }>()
  for (const l of todayLogs) {
    const e = logByStay.get(l.appointmentId) ?? {}
    if (l.period === 'AM') e.AM = l; else e.PM = l
    logByStay.set(l.appointmentId, e)
  }
  const flagsFor = (apptId: string) => {
    const e = logByStay.get(apptId)
    return [...new Set([...(e?.AM ? logRedFlags(e.AM) : []), ...(e?.PM ? logRedFlags(e.PM) : [])])]
  }

  async function toggleTask(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const t = await db.careTask.findUnique({ where: { id } })
    if (!t) return
    const s = await getSession()
    await db.careTask.update({
      where: { id },
      data: t.done
        ? { done: false, doneAt: null, staffId: null }
        : { done: true, doneAt: new Date(), staffId: s?.kind === 'staff' ? s.staffId : null },
    })
    revalidatePath('/runsheet')
  }

  const seg = SEGMENTS.boarding
  const totalTasks = tasks.length
  const doneTasks = tasks.filter(t => t.done).length
  const donePct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  // Split the in-house cats: those leaving today go to the Check-out section.
  const departures = stays.filter(s => s.endsAt && s.endsAt < todayEnd)
  const ongoing = stays.filter(s => !(s.endsAt && s.endsAt < todayEnd))

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Boarding Run Sheet
          </h1>
          <p className="text-sm cd-muted">
            {now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })} ·
            {' '}{stays.length} cat{stays.length === 1 ? '' : 's'} in house · {doneTasks}/{totalTasks} tasks done
            {session.kind === 'staff' && ` · ticking as ${session.name}`}
          </p>
        </div>
        <Link href="/rooms/calendar" className="cd-btn-sec text-sm">Room calendar</Link>
      </div>

      {/* ── Section 1 · Checking in today ── */}
      {arrivals.length > 0 && (
        <div className="space-y-2">
          <SectionHeader color="#B8902B" label={`Checking in today (${arrivals.length})`} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {arrivals.map(a => {
              const g = boardingHealthGate(a.cat)
              return (
                <div key={a.id} className="cd-card p-3" style={{ borderLeft: '4px solid #B8902B' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Link href={`/cats/${a.catId}`} className="font-semibold text-sm hover:underline" style={{ color: '#2D1907' }}>{a.cat.name}</Link>
                      <div className="text-xs cd-muted">{a.room?.name ?? 'No room'} · {a.customer.name ?? displayPhone(a.customer.phone)}</div>
                    </div>
                    <Link href={`/runsheet/${a.id}/checkin`} className="cd-btn text-sm">Check in →</Link>
                  </div>
                  {(g.blockers.length > 0 || g.treatmentsNeeded.length > 0) && (
                    <div className="text-xs mt-2 rounded px-2 py-1" style={g.blockers.length > 0
                      ? { background: 'rgba(177,73,25,0.12)', color: '#B14919' }
                      : { background: 'rgba(184,144,43,0.16)', color: '#8a6c00' }}>
                      {g.blockers.length > 0 ? `⚠ ${g.blockers.join(', ')} needed` : `${g.treatmentsNeeded.join(' + ')} treatment (RM ${g.autoChargeRM})`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Today's care progress */}
      {totalTasks > 0 && (
        <div className="cd-card px-4 py-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: seg.text }}>
              Today&apos;s care progress
            </span>
            <span className="text-sm font-bold" style={{ color: donePct === 100 ? '#5c6b3c' : '#2D1907' }}>
              {donePct === 100 ? 'All done 🐾' : `${doneTasks}/${totalTasks} · ${donePct}%`}
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(45,25,7,0.08)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${donePct}%`, background: donePct === 100 ? '#7A8A4F' : seg.color }} />
          </div>
        </div>
      )}

      {stays.length === 0 && arrivals.length === 0 ? (
        <div className="cd-card py-16 text-center">
          <div className="text-3xl mb-2">🛏️</div>
          <p className="cd-muted text-sm">No cats checked in for boarding right now. Check-ins appear here automatically with their daily care list.</p>
        </div>
      ) : ongoing.length > 0 && (
        <div className="space-y-2">
        <SectionHeader color={seg.color} label={`In house (${ongoing.length})`} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ongoing.map(s => {
            const list = byStay.get(s.id) ?? []
            const doneCount = list.filter(t => t.done).length
            const checkoutToday = s.endsAt && s.endsAt < todayEnd
            return (
              <div key={s.id} className="cd-card overflow-hidden" style={{ borderTop: `3px solid ${seg.color}` }}>
                <div className="cd-section-header" style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}>
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2" style={{ color: '#2D1907' }}>
                      {s.room?.name ?? 'No room'} · <Link href={`/cats/${s.catId}`} className="hover:underline">{s.cat.name}</Link>
                      {checkoutToday && (
                        <>
                          <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>checks out today</span>
                          <Link href={`/pos?customerId=${s.customerId}`}
                            className="cd-pill font-medium" style={{ background: '#2D1907', color: '#ECDBB6' }}>
                            Checkout →
                          </Link>
                        </>
                      )}
                    </div>
                    <div className="text-xs cd-muted">
                      {s.customer.name ?? displayPhone(s.customer.phone)} · until {s.endsAt ? s.endsAt.toLocaleDateString('en-MY') : '—'}
                    </div>
                  </div>
                  <span className="cd-pill" style={{ background: seg.bg, color: seg.text }}>{doneCount}/{list.length}</span>
                </div>

                {/* Per-room progress */}
                {list.length > 0 && (
                  <div className="h-1.5" style={{ background: 'rgba(45,25,7,0.06)' }}>
                    <div className="h-full transition-all"
                      style={{
                        width: `${Math.round((doneCount / list.length) * 100)}%`,
                        background: doneCount === list.length ? '#7A8A4F' : seg.color,
                      }} />
                  </div>
                )}

                {(s.cat.careNotes || s.cat.healthNotes) && (
                  <div className="px-4 py-2 text-xs" style={{ background: 'rgba(231,206,122,0.3)', color: '#2D1907' }}>
                    {s.cat.careNotes && <div><strong>Care:</strong> {s.cat.careNotes}</div>}
                    {s.cat.healthNotes && <div><strong>Health:</strong> {s.cat.healthNotes}</div>}
                  </div>
                )}

                {/* Red-flag banner from today's structured logs (SOP S004) */}
                {flagsFor(s.id).length > 0 && (
                  <div className="px-4 py-2 text-xs font-medium" style={{ background: 'rgba(177,73,25,0.14)', color: '#B14919' }}>
                    ⚠ {flagsFor(s.id).join(' · ')} — tell the manager/owner
                  </div>
                )}

                <ul>
                  {list.map(t => (
                    <li key={t.id} className="px-4 py-1.5 flex items-center justify-between" style={{ borderTop: '1px solid rgba(45,25,7,0.06)' }}>
                      <form action={toggleTask} className="flex items-center gap-2.5 flex-1">
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit"
                          className="rounded-md flex items-center justify-center text-xs font-bold"
                          style={{
                            width: 22, height: 22,
                            background: t.done ? seg.color : 'transparent',
                            color: t.done ? '#F2EDE0' : 'transparent',
                            border: `1.5px solid ${t.done ? seg.color : 'rgba(45,25,7,0.25)'}`,
                          }}>
                          ✓
                        </button>
                        <span className="flex items-baseline gap-1.5 text-sm">
                          <span aria-hidden className="text-[15px] leading-none" style={{ opacity: t.done ? 0.45 : 1 }}>{taskEmoji(t.task)}</span>
                          <span style={{ color: t.done ? 'rgba(45,25,7,0.4)' : '#2D1907', textDecoration: t.done ? 'line-through' : 'none' }}>
                            {t.task}
                          </span>
                        </span>
                      </form>
                      {t.task === 'Photo update to owner' && !t.done && (
                        <a href={whatsappUrl(s.customer.phone, `Hi! Daily update from ${business.name} 🐾 ${s.cat.name} is doing great today — photo coming right up! 📸`)}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded" style={{ background: '#729094', color: '#F2EDE0' }}>
                          WhatsApp
                        </a>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Daily health log (SOP S004) — the prominent action below the
                    checklist: two big AM/PM buttons so it's never missed. */}
                <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(45,25,7,0.12)', background: 'rgba(114,144,148,0.1)' }}>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: seg.text }}>
                    <span aria-hidden>🩺</span> Daily health log
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {([['AM', '☀️', 'Morning'], ['PM', '🌙', 'Evening']] as const).map(([p, emoji, label]) => {
                      const done = !!logByStay.get(s.id)?.[p]
                      return (
                        <Link key={p} href={`/runsheet/${s.id}/log?period=${p}`}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold"
                          style={done
                            ? { background: 'rgba(122,138,79,0.2)', color: '#5c6b3c', border: '1px solid rgba(122,138,79,0.45)' }
                            : { background: seg.color, color: '#F2EDE0' }}>
                          <span aria-hidden className="text-[15px] leading-none">{emoji}</span>
                          {done ? `${label} logged ✓` : `Log ${label}`}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        </div>
      )}

      {/* ── Section 3 · Checking out today ── */}
      {departures.length > 0 && (
        <div className="space-y-2">
          <SectionHeader color="#B14919" label={`Checking out today (${departures.length})`} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {departures.map(s => (
              <div key={s.id} className="cd-card p-3" style={{ borderLeft: '4px solid #B14919' }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Link href={`/cats/${s.catId}`} className="font-semibold text-sm hover:underline" style={{ color: '#2D1907' }}>{s.cat.name}</Link>
                    <div className="text-xs cd-muted">{s.room?.name ?? 'No room'} · {s.customer.name ?? displayPhone(s.customer.phone)}</div>
                  </div>
                  <Link href={`/runsheet/${s.id}/checkout`} className="cd-btn text-sm">Check out →</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// A glyph per care-task type, matched on the task label, so staff can scan the
// checklist at a glance. Full-litter-change is checked before the generic litter
// clean (order matters).
function taskEmoji(task: string): string {
  if (/^feed/i.test(task)) return '🍽️'
  if (/water/i.test(task)) return '💧'
  if (/full litter/i.test(task)) return '🧺'
  if (/litter/i.test(task)) return '🧹'
  if (/medication/i.test(task)) return '💊'
  if (/play|enrich/i.test(task)) return '🧶'
  if (/photo/i.test(task)) return '📸'
  return '🐾'
}

function SectionHeader({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-1" style={{ borderBottom: `2px solid ${color}` }}>
      <span className="rounded-full" style={{ width: 9, height: 9, background: color }} />
      <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>{label}</h2>
    </div>
  )
}
