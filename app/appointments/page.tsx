import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES } from '@/lib/constants'
import { DatePicker } from './DatePicker'

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; type?: string; status?: string }>
}) {
  await requireAuth()
  const { date, type, status } = await searchParams

  const dateFilter = date ? new Date(date) : new Date()
  const dayStart = new Date(dateFilter.getFullYear(), dateFilter.getMonth(), dateFilter.getDate())
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  const where: Record<string, unknown> = { scheduledAt: { gte: dayStart, lt: dayEnd } }
  if (type) where.type = type
  if (status) where.status = status

  const appointments = await db.appointment.findMany({
    where,
    include: { customer: true, cat: true, room: true },
    orderBy: { scheduledAt: 'asc' },
  })

  const dateStr = dayStart.toISOString().split('T')[0]
  const prevDay = new Date(dayStart.getTime() - 86400000).toISOString().split('T')[0]
  const nextDay = new Date(dayStart.getTime() + 86400000).toISOString().split('T')[0]

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Appointments</h1>
        <Link href="/appointments/new" className="cd-btn">+ Book</Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Link href={`?date=${prevDay}`} className="px-2 py-1 text-sm cd-btn-sec rounded">←</Link>
          <DatePicker defaultValue={dateStr} />
          <Link href={`?date=${nextDay}`} className="px-2 py-1 text-sm cd-btn-sec rounded">→</Link>
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="date" value={dateStr} />
          <select name="type" defaultValue={type ?? ''} className="cd-input" style={{ width: 'auto' }}>
            <option value="">All types</option>
            {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="status" defaultValue={status ?? ''} className="cd-input" style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="submit" className="cd-btn-sec">Filter</button>
        </form>
      </div>

      <div className="cd-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="cd-thead">
            <th>Time</th>
            <th>Cat</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Room</th>
            <th>Status</th>
            <th>Price</th>
            <th></th>
          </tr></thead>
          <tbody className="cd-tbody">
            {appointments.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center cd-muted">No appointments on this day</td></tr>
            )}
            {appointments.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium" style={{ color: '#2D1907' }}>
                  {a.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3" style={{ color: '#2D1907' }}>{a.cat.name}</td>
                <td className="px-4 py-3 cd-muted">{a.customer.name ?? a.customer.phone}</td>
                <td className="px-4 py-3 cd-muted">{a.type}</td>
                <td className="px-4 py-3 cd-muted">{a.room?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="cd-pill" style={apptStatusStyle(a.status)}>{a.status}</span>
                </td>
                <td className="px-4 py-3 cd-muted">{a.price != null ? `RM ${a.price.toFixed(2)}` : '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/appointments/${a.id}`} className="text-xs cd-link">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function apptStatusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Scheduled:  { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    CheckedIn:  { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
