import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { CARE_TASKS, CARE_TASK_MEDICATION } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { displayPhone, whatsappUrl } from '@/lib/phone'

const DAY = 24 * 60 * 60 * 1000
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The boarding run sheet: a generated daily checklist for every occupied room,
// built from each cat's own care notes. Ticking is the work record.
export default async function RunSheetPage() {
  const session = await requireAuth()
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

  // Ensure today's tasks exist for each stay (idempotent)
  const existing = await db.careTask.findMany({ where: { date: today } })
  const have = new Set(existing.map(t => `${t.appointmentId}|${t.task}`))
  const toCreate: { date: string; appointmentId: string; catId: string; task: string }[] = []
  for (const s of stays) {
    const tasks: string[] = [...CARE_TASKS]
    if (s.cat.careNotes || s.cat.healthNotes) tasks.push(CARE_TASK_MEDICATION)
    for (const task of tasks) {
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

      {stays.length === 0 ? (
        <div className="cd-card py-16 text-center">
          <div className="text-3xl mb-2">🛏️</div>
          <p className="cd-muted text-sm">No cats checked in for boarding right now. Check-ins appear here automatically with their daily care list.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stays.map(s => {
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

                {(s.cat.careNotes || s.cat.healthNotes) && (
                  <div className="px-4 py-2 text-xs" style={{ background: 'rgba(231,206,122,0.3)', color: '#2D1907' }}>
                    {s.cat.careNotes && <div><strong>Care:</strong> {s.cat.careNotes}</div>}
                    {s.cat.healthNotes && <div><strong>Health:</strong> {s.cat.healthNotes}</div>}
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
                        <span className="text-sm" style={{ color: t.done ? 'rgba(45,25,7,0.4)' : '#2D1907', textDecoration: t.done ? 'line-through' : 'none' }}>
                          {t.task}
                        </span>
                      </form>
                      {t.task === 'Photo update to owner' && !t.done && (
                        <a href={whatsappUrl(s.customer.phone, `Hi! Daily update from Cat Day 🐾 ${s.cat.name} is doing great today — photo coming right up! 📸`)}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded" style={{ background: '#729094', color: '#F2EDE0' }}>
                          WhatsApp
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
