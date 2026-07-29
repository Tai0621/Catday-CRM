import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { isMediaConfigured } from '@/lib/media'
import { entryMinutes, fmtDuration } from '@/lib/hr'
import { ClockButton } from './ClockButton'

const TEAL = '#729094'

// Staff self-service time clock. One big status line, one big button. The punch
// captures a selfie (anti-buddy-punch) when photo storage is on.
export default async function TimeClockPage() {
  const session = await requireAuth()

  if (session.kind !== 'staff') {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className="cd-card p-6 text-center space-y-2">
          <h1 className="text-lg font-bold" style={{ color: '#2D1907' }}>Time Clock</h1>
          <p className="text-sm cd-muted">Clocking in is for staff accounts. As a manager you can review everyone&apos;s attendance instead.</p>
          <Link href="/hr/attendance" className="cd-btn text-sm inline-block mt-1">Go to Attendance →</Link>
        </div>
      </div>
    )
  }

  const staffId = session.staffId
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [open, todays] = await Promise.all([
    db.timeEntry.findFirst({ where: { staffId, clockOutAt: null }, orderBy: { clockInAt: 'desc' } }),
    db.timeEntry.findMany({ where: { staffId, clockInAt: { gte: dayStart } }, orderBy: { clockInAt: 'desc' } }),
  ])
  const clockedIn = !!open
  const t = (d: Date) => d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Hi, {session.name.split(' ')[0]}</h1>
        <p className="text-sm cd-muted">{now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Status */}
      <div className="cd-card p-6 text-center space-y-1"
        style={clockedIn ? { background: 'rgba(95,122,63,0.12)', border: '1px solid rgba(95,122,63,0.35)' } : undefined}>
        <div className="text-sm uppercase tracking-wider font-semibold" style={{ color: clockedIn ? '#4d6330' : TEAL }}>
          {clockedIn ? "You're clocked in" : "You're clocked out"}
        </div>
        {clockedIn && open && (
          <div className="text-2xl font-bold" style={{ color: '#2D1907' }}>
            since {t(open.clockInAt)} · {fmtDuration(entryMinutes(open.clockInAt, null))}
          </div>
        )}
      </div>

      <ClockButton mode={clockedIn ? 'out' : 'in'} staffId={staffId} mediaConfigured={isMediaConfigured()} />

      {/* Today's punches */}
      {todays.length > 0 && (
        <div className="cd-card overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider cd-muted" style={{ borderBottom: '1px solid rgba(45,25,7,0.08)' }}>
            Today
          </div>
          <table className="w-full text-sm">
            <tbody className="cd-tbody">
              {todays.map(e => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>
                    {t(e.clockInAt)} → {e.clockOutAt ? t(e.clockOutAt) : <span style={{ color: '#4d6330' }}>now</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right cd-muted">{fmtDuration(entryMinutes(e.clockInAt, e.clockOutAt))}</td>
                  <td className="px-4 py-2.5 text-right">
                    {e.onPremiseIn === false && (
                      <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919' }}>off-site</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
