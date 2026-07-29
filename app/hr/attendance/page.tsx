import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getHrConfig, setHrConfig, entryMinutes, fmtDuration, clientIp } from '@/lib/hr'
import { recordAudit } from '@/lib/audit'
import { SEGMENTS } from '@/lib/segments'

const DAY = 24 * 60 * 60 * 1000

// HR · Attendance. Today's punches (with anti-buddy-punch selfies + on/off-site
// flags), a 7-day per-staff hours summary, and the clock-in security settings.
export default async function AttendancePage() {
  await requireManager()
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(dayStart.getTime() - 6 * DAY)

  const [todays, week, hr, myIp] = await Promise.all([
    db.timeEntry.findMany({ where: { clockInAt: { gte: dayStart } }, include: { staff: { select: { name: true } } }, orderBy: { clockInAt: 'desc' } }),
    db.timeEntry.findMany({ where: { clockInAt: { gte: weekStart } }, include: { staff: { select: { name: true } } } }),
    getHrConfig(),
    clientIp((await headers()).get('x-forwarded-for')),
  ])

  // 7-day hours per staff
  const byStaff = new Map<string, { name: string; mins: number }>()
  for (const e of week) {
    const cur = byStaff.get(e.staffId) ?? { name: e.staff.name, mins: 0 }
    cur.mins += entryMinutes(e.clockInAt, e.clockOutAt)
    byStaff.set(e.staffId, cur)
  }
  const summary = [...byStaff.values()].sort((a, b) => b.mins - a.mins)

  async function saveSettings(data: FormData) {
    'use server'
    const ips = ((data.get('allowedIps') as string) ?? '').trim()
    const enforce = data.get('enforce') === 'on'
    await setHrConfig(ips, enforce)
    await recordAudit({ action: 'hr.settings', entityType: 'HrConfig', summary: `Updated clock-in security (enforce ${enforce ? 'on' : 'off'})`, detail: { ips, enforce } })
    revalidatePath('/hr/attendance')
  }

  const t = (d: Date) => d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })
  const seg = SEGMENTS.boarding

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs cd-muted">Human Resource</span>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Attendance</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Attendance
        </h1>
        <p className="text-sm cd-muted">{now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })} · {todays.length} punch{todays.length === 1 ? '' : 'es'} today</p>
      </div>

      {/* Today */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Today</h2>
        <div className="cd-card overflow-hidden">
          {todays.length === 0 ? (
            <p className="px-4 py-8 text-sm cd-muted text-center">No one has clocked in yet today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="cd-thead"><th>Staff</th><th>In</th><th>Out</th><th>Hours</th><th>Location</th><th>Photos</th></tr></thead>
                <tbody className="cd-tbody">
                  {todays.map(e => (
                    <tr key={e.id}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>{e.staff.name}</td>
                      <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>{t(e.clockInAt)}</td>
                      <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>{e.clockOutAt ? t(e.clockOutAt) : <span style={{ color: '#4d6330' }}>still in</span>}</td>
                      <td className="px-4 py-2.5 cd-muted">{fmtDuration(entryMinutes(e.clockInAt, e.clockOutAt))}</td>
                      <td className="px-4 py-2.5">
                        {e.onPremiseIn === false
                          ? <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919' }}>off-site</span>
                          : e.onPremiseIn === true
                          ? <span className="cd-pill" style={{ background: 'rgba(95,122,63,0.16)', color: '#4d6330' }}>on-site</span>
                          : <span className="cd-muted text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          {e.clockInPhotoId && <PunchPhoto id={e.clockInPhotoId} />}
                          {e.clockOutPhotoId && <PunchPhoto id={e.clockOutPhotoId} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* 7-day summary */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Last 7 days</h2>
        <div className="cd-card overflow-hidden">
          {summary.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No hours recorded in the last 7 days.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {summary.map(s => (
                  <tr key={s.name}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>{s.name}</td>
                    <td className="px-4 py-2.5 text-right cd-muted">{fmtDuration(s.mins)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Clock-in security */}
      <section>
        <h2 className="font-semibold mb-1" style={{ color: '#2D1907' }}>Clock-in security</h2>
        <p className="text-xs cd-muted mb-3">
          List the shop&apos;s allowed IP addresses (comma-separated; end with a dot for a whole range, e.g. <code>203.0.113.</code>).
          Your current IP is <strong>{myIp ?? 'unknown'}</strong>. Until you turn on enforcement, off-site punches are allowed but flagged.
        </p>
        <form action={saveSettings} className="cd-card p-4 space-y-3">
          <div>
            <label className="cd-label">Allowed IP addresses</label>
            <textarea name="allowedIps" rows={2} className="cd-input" defaultValue={hr.allowedIps.join(', ')} placeholder="e.g. 203.0.113.7, 203.0.113." />
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: '#2D1907' }}>
            <input type="checkbox" name="enforce" defaultChecked={hr.enforceOnPremise} />
            Block clock-in from anywhere not on the list
          </label>
          <div className="flex justify-end">
            <button type="submit" className="cd-btn text-sm">Save</button>
          </div>
        </form>
      </section>
    </div>
  )
}

// eslint-disable-next-line @next/next/no-img-element
function PunchPhoto({ id }: { id: string }) {
  return <img src={`/api/media/${id}/file`} alt="clock-in" className="rounded object-cover" style={{ width: 34, height: 34 }} />
}
