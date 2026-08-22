import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { LEAVE_TYPES } from '@/lib/constants'
import { leaveDays, isoDay, LEAVE_STATUS_STYLE } from '@/lib/leave'
import { SubmitButton } from '@/app/components/Pending'

const TEAL = '#729094'

// Staff self-service leave — request time off and track its status.
export default async function LeavePage() {
  const session = await requireAuth()
  if (session.kind !== 'staff') {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className="cd-card p-6 text-center space-y-2">
          <h1 className="text-lg font-bold" style={{ color: '#2D1907' }}>Leave</h1>
          <p className="text-sm cd-muted">Requesting leave is for staff accounts. As a manager you review and approve leave.</p>
          <Link href="/hr/leave" className="cd-btn text-sm inline-block mt-1">Go to Leave admin →</Link>
        </div>
      </div>
    )
  }

  const requests = await db.leaveRequest.findMany({ where: { staffId: session.staffId }, orderBy: { createdAt: 'desc' }, take: 30 })
  const today = isoDay(new Date())

  async function requestLeave(data: FormData) {
    'use server'
    const s = await getSession()
    if (s?.kind !== 'staff') return
    const type = (data.get('type') as string) || 'Annual'
    const startDate = ((data.get('startDate') as string) || '').trim()
    const endRaw = ((data.get('endDate') as string) || '').trim()
    const reason = ((data.get('reason') as string) || '').trim() || null
    if (!startDate || !(LEAVE_TYPES as readonly string[]).includes(type)) return
    const endDate = endRaw && endRaw >= startDate ? endRaw : startDate
    await db.leaveRequest.create({ data: { staffId: s.staffId, type, startDate, endDate, days: leaveDays(startDate, endDate), reason } })
    revalidatePath('/leave')
  }

  async function cancelLeave(data: FormData) {
    'use server'
    const s = await getSession()
    if (s?.kind !== 'staff') return
    await db.leaveRequest.deleteMany({ where: { id: data.get('id') as string, staffId: s.staffId, status: 'Pending' } })
    revalidatePath('/leave')
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: TEAL }} />
          My Leave
        </h1>
        <p className="text-sm cd-muted">Request time off — your manager approves it.</p>
      </div>

      <form action={requestLeave} className="cd-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="cd-label">Type</label>
            <select name="type" className="cd-input">
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Reason (optional)</label>
            <input name="reason" className="cd-input" placeholder="e.g. family trip" />
          </div>
          <div>
            <label className="cd-label">From</label>
            <input name="startDate" type="date" required min={today} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">To</label>
            <input name="endDate" type="date" min={today} className="cd-input" />
          </div>
        </div>
        <p className="text-xs cd-muted">Leave “To” blank for a single day.</p>
        <div className="flex justify-end">
          <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Request leave</SubmitButton>
        </div>
      </form>

      <div className="cd-card overflow-hidden">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider cd-muted" style={{ borderBottom: '1px solid rgba(45,25,7,0.08)' }}>My requests</div>
        {requests.length === 0 ? (
          <p className="px-4 py-6 text-sm cd-muted text-center">No leave requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {requests.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>
                      <span className="font-medium">{r.type}</span>
                      <span className="cd-muted"> · {r.startDate}{r.endDate !== r.startDate ? ` → ${r.endDate}` : ''} ({r.days}d)</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="cd-pill" style={LEAVE_STATUS_STYLE[r.status]}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'Pending' && (
                        <form action={cancelLeave}>
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton className="text-xs cd-link" busyLabel="Working…">Cancel</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
