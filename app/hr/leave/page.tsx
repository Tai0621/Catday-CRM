import { requireManager, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { isoDay, coversDay, LEAVE_STATUS_STYLE } from '@/lib/leave'
import { recordAudit } from '@/lib/audit'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// HR · Leave admin. Approve/reject pending requests and see a who's-off month
// calendar of approved leave.
export default async function LeaveAdminPage() {
  await requireManager()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const mStart = isoDay(monthStart), mEnd = isoDay(monthEnd)

  const [pending, approved, recent] = await Promise.all([
    db.leaveRequest.findMany({ where: { status: 'Pending' }, include: { staff: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    db.leaveRequest.findMany({ where: { status: 'Approved', startDate: { lte: mEnd }, endDate: { gte: mStart } }, include: { staff: { select: { name: true } } } }),
    db.leaveRequest.findMany({ include: { staff: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])

  async function review(data: FormData) {
    'use server'
    const s = await getSession()
    const id = data.get('id') as string
    const decision = data.get('decision') as string
    if (decision !== 'Approved' && decision !== 'Rejected') return
    const lr = await db.leaveRequest.findUnique({ where: { id }, include: { staff: { select: { name: true } } } })
    if (!lr || lr.status !== 'Pending') return
    await db.leaveRequest.update({ where: { id }, data: { status: decision, reviewedBy: s?.name ?? 'Manager', reviewedAt: new Date() } })
    await recordAudit({ action: 'leave.review', entityType: 'LeaveRequest', entityId: id, summary: `${decision} leave for ${lr.staff.name} (${lr.type} ${lr.startDate}${lr.endDate !== lr.startDate ? `→${lr.endDate}` : ''})` }, s)
    revalidatePath('/hr/leave')
    revalidatePath('/actions')
  }

  // Month grid: leading blanks so day 1 lands on the right weekday (Mon-first).
  const firstWeekday = (monthStart.getDay() + 6) % 7 // 0 = Mon
  const daysInMonth = monthEnd.getDate()
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const seg = SEGMENTS.boarding
  const offOn = (day: string) => approved.filter(a => coversDay(a.startDate, a.endDate, day))

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs cd-muted">Human Resource</span>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Leave</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Leave
        </h1>
        <p className="text-sm cd-muted">{pending.length} pending · {now.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Pending queue */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Pending approval</h2>
        {pending.length === 0 ? (
          <div className="cd-card px-4 py-6 text-sm cd-muted text-center">Nothing waiting — all caught up.</div>
        ) : (
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="cd-card p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium" style={{ color: '#2D1907' }}>{r.staff.name} · {r.type}</div>
                  <div className="text-xs cd-muted">{r.startDate}{r.endDate !== r.startDate ? ` → ${r.endDate}` : ''} ({r.days} day{r.days === 1 ? '' : 's'}){r.reason ? ` · ${r.reason}` : ''}</div>
                </div>
                <div className="flex gap-2">
                  <form action={review}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="Approved" /><SubmitButton className="cd-btn text-sm" busyLabel="Working…">Approve</SubmitButton></form>
                  <form action={review}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="Rejected" /><SubmitButton className="cd-btn-sec text-sm" busyLabel="Working…">Reject</SubmitButton></form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Who's-off calendar */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Who&apos;s off this month</h2>
        <div className="cd-card p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(d => <div key={d} className="text-center text-[11px] font-semibold uppercase tracking-wider cd-muted py-1">{d}</div>)}
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />
              const dayStr = isoDay(new Date(now.getFullYear(), now.getMonth(), day))
              const off = offOn(dayStr)
              const isToday = dayStr === isoDay(now)
              return (
                <div key={dayStr} className="rounded-lg p-1.5 min-h-[54px]"
                  style={{ border: `1px solid ${isToday ? seg.color : 'rgba(45,25,7,0.1)'}`, background: off.length ? 'rgba(114,144,148,0.1)' : undefined }}>
                  <div className="text-xs font-semibold" style={{ color: isToday ? seg.color : '#2D1907' }}>{day}</div>
                  <div className="space-y-0.5 mt-0.5">
                    {off.map(a => (
                      <div key={a.id} className="text-[10px] leading-tight truncate rounded px-1"
                        style={{ background: 'rgba(114,144,148,0.25)', color: '#4a666a' }} title={`${a.staff.name} · ${a.type}`}>
                        {a.staff.name.split(' ')[0]}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Recent decisions */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Recent requests</h2>
        <div className="cd-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {recent.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>{r.staff.name}</td>
                    <td className="px-4 py-2.5 cd-muted">{r.type} · {r.startDate}{r.endDate !== r.startDate ? ` → ${r.endDate}` : ''}</td>
                    <td className="px-4 py-2.5 text-right"><span className="cd-pill" style={LEAVE_STATUS_STYLE[r.status]}>{r.status}</span></td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td className="px-4 py-6 text-sm cd-muted text-center" colSpan={3}>No requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
