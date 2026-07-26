import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { BOARD_FLOW, BOARD_COLUMN_LABELS, BOARD_ADVANCE_LABELS, BOARD_STAGE_COLORS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { displayPhone, whatsappUrl } from '@/lib/phone'

const BOARD_TYPES = ['Grooming', 'Bath', 'Diagnosis']
const DAY = 24 * 60 * 60 * 1000

// The grooming service board — every cat in the store today, moving left to
// right. Staff advance the card; front desk sees "Ready" without walking over.
export default async function BoardPage() {
  const session = await requireAuth()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)

  const [appts, groomers] = await Promise.all([
    db.appointment.findMany({
      where: {
        type: { in: BOARD_TYPES },
        scheduledAt: { gte: todayStart, lt: todayEnd },
        status: { notIn: ['Cancelled', 'NoShow'] },
      },
      include: { customer: true, cat: true, service: true, staff: true },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.staff.findMany({ where: { active: true, role: 'Groomer' }, orderBy: { name: 'asc' } }),
  ])

  async function advance(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const current = data.get('current') as string
    const idx = BOARD_FLOW.indexOf(current as (typeof BOARD_FLOW)[number])
    if (idx < 0 || idx >= BOARD_FLOW.length - 1) return
    const next = BOARD_FLOW[idx + 1]
    const s = await getSession()
    const appt = await db.appointment.findUnique({ where: { id }, select: { staffId: true } })
    // Starting the service claims it for the logged-in groomer if unassigned
    const claim = next === 'InService' && !appt?.staffId && s?.kind === 'staff' && s.role === 'Groomer'
    await db.appointment.update({
      where: { id },
      data: { status: next, ...(claim ? { staffId: s.kind === 'staff' ? s.staffId : null } : {}) },
    })
    revalidatePath('/board')
  }

  async function assign(data: FormData) {
    'use server'
    await db.appointment.update({
      where: { id: data.get('id') as string },
      data: { staffId: (data.get('staffId') as string) || null },
    })
    revalidatePath('/board')
  }

  async function markNoShow(data: FormData) {
    'use server'
    await db.appointment.update({ where: { id: data.get('id') as string }, data: { status: 'NoShow' } })
    revalidatePath('/board')
  }

  const columns = BOARD_FLOW.slice(0, 5) // Completed cats drop off the board
  const done = appts.filter(a => a.status === 'Completed')
  const seg = SEGMENTS.grooming

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Service Board
          </h1>
          <p className="text-sm cd-muted">
            {now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })} ·
            {' '}{appts.length - done.length} in flow · {done.length} done
            {session.kind === 'staff' && ` · logged in as ${session.name}`}
          </p>
        </div>
        <Link href="/appointments/new" className="cd-btn text-sm">+ Book</Link>
      </div>

      {appts.length === 0 ? (
        <div className="cd-card py-16 text-center">
          <div className="text-3xl mb-2">✂️</div>
          <p className="cd-muted text-sm">No grooming, bath or diagnosis appointments today.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {columns.map(col => {
            const items = appts.filter(a => a.status === col)
            const sc = BOARD_STAGE_COLORS[col]
            return (
              <div key={col} className="space-y-2">
                <div className="flex items-center gap-2 px-1 pb-1" style={{ borderBottom: `2px solid ${sc.color}` }}>
                  <span className="rounded-full" style={{ width: 9, height: 9, background: sc.color }} />
                  <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: sc.color }}>
                    {BOARD_COLUMN_LABELS[col]}
                  </h2>
                  <span className="cd-pill ml-auto" style={{ background: sc.bg, color: sc.color, fontWeight: 700 }}>{items.length}</span>
                </div>
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs cd-muted"
                    style={{ borderColor: 'rgba(45,25,7,0.15)' }}>—</div>
                )}
                {items.map(a => (
                  <div key={a.id} className="cd-card p-3 space-y-2"
                    style={{ borderTop: `4px solid ${sc.color}`, background: sc.bg }}>
                    <div>
                      <div className="flex items-center justify-between">
                        <Link href={`/cats/${a.catId}`} className="font-semibold text-sm hover:underline" style={{ color: '#2D1907' }}>
                          {a.cat.name}
                        </Link>
                        <span className="text-xs cd-muted">
                          {a.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-xs cd-muted truncate">
                        {a.service?.name ?? a.type} · {a.customer.name ?? displayPhone(a.customer.phone)}
                      </div>
                      {a.cat.healthNotes && (
                        <div className="text-xs mt-1 rounded px-1.5 py-0.5" style={{ background: 'rgba(231,206,122,0.35)', color: '#7a5c00' }}>
                          ⚕ {a.cat.healthNotes}
                        </div>
                      )}
                    </div>

                    {/* Groomer */}
                    <form action={assign} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      <select name="staffId" defaultValue={a.staffId ?? ''} className="cd-input text-xs" style={{ padding: '0.2rem 0.4rem', width: 'auto', flex: 1 }}>
                        <option value="">No groomer</option>
                        {groomers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      <button type="submit" className="cd-btn-sec text-xs" style={{ padding: '0.2rem 0.5rem' }}>✓</button>
                    </form>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <form action={advance}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="current" value={a.status} />
                        <button type="submit" className="text-xs px-2.5 py-1 rounded-lg font-medium"
                          style={{ background: sc.color, color: '#F2EDE0' }}>
                          {BOARD_ADVANCE_LABELS[a.status]} →
                        </button>
                      </form>
                      {(a.status === 'InService' || a.status === 'QualityCheck') && (
                        <Link href={`/cats/${a.catId}/assess?appt=${a.id}`} className="text-xs px-2 py-1 rounded-lg cd-btn-sec">
                          {a.status === 'InService' ? 'Photos & assess' : 'Assessment'}
                        </Link>
                      )}
                      {a.status === 'Ready' && (
                        <>
                          <a href={whatsappUrl(a.customer.phone, `Hi! ${a.cat.name} is all done and looking fabulous — ready for pickup whenever you are 🐾✨`)}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded-lg" style={{ background: '#729094', color: '#F2EDE0' }}>
                            WhatsApp
                          </a>
                          <Link href={`/pos?customerId=${a.customerId}`}
                            className="text-xs px-2 py-1 rounded-lg font-medium"
                            style={{ background: '#2D1907', color: '#ECDBB6' }}>
                            Checkout
                          </Link>
                        </>
                      )}
                      {a.status === 'Scheduled' && (
                        <form action={markNoShow}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="text-xs px-2 py-1 rounded-lg"
                            style={{ color: 'rgba(45,25,7,0.45)', border: '1px solid rgba(45,25,7,0.15)' }}>
                            No-show
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {done.length > 0 && (
        <div className="cd-card px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider cd-muted">Done today: </span>
          <span className="text-sm" style={{ color: '#2D1907' }}>
            {done.map(a => `${a.cat.name}${a.paid ? '' : ' (unpaid)'}`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}
