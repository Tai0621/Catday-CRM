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

  const where: Record<string, unknown> = {
    scheduledAt: { gte: dayStart, lt: dayEnd },
  }
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
        <h1 className="text-xl font-bold text-gray-900">Appointments</h1>
        <Link href="/appointments/new" className="bg-rose-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-rose-700">+ Book</Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Link href={`?date=${prevDay}`} className="px-2 py-1 border rounded hover:bg-gray-50 text-sm">←</Link>
          <DatePicker defaultValue={dateStr} />
          <Link href={`?date=${nextDay}`} className="px-2 py-1 border rounded hover:bg-gray-50 text-sm">→</Link>
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="date" value={dateStr} />
          <select name="type" defaultValue={type ?? ''}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">All types</option>
            {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="status" defaultValue={status ?? ''}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="submit" className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-200">Filter</button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Cat</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Room</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Price</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {appointments.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No appointments on this day</td></tr>
            )}
            {appointments.map(a => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  {a.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3">{a.cat.name}</td>
                <td className="px-4 py-3 text-gray-600">{a.customer.name ?? a.customer.phone}</td>
                <td className="px-4 py-3 text-gray-600">{a.type}</td>
                <td className="px-4 py-3 text-gray-400">{a.room?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(a.status)}`}>{a.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{a.price != null ? `RM ${a.price.toFixed(2)}` : '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/appointments/${a.id}`} className="text-xs text-rose-600 hover:underline">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function statusClass(s: string) {
  const m: Record<string, string> = {
    Scheduled: 'bg-blue-100 text-blue-700',
    CheckedIn: 'bg-amber-100 text-amber-700',
    Completed: 'bg-green-100 text-green-700',
    NoShow: 'bg-red-100 text-red-700',
    Cancelled: 'bg-gray-100 text-gray-500',
  }
  return m[s] ?? 'bg-gray-100 text-gray-500'
}
