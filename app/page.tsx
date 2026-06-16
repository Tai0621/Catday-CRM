import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildGroomingPredictions } from '@/lib/grooming-reminder'
import { whatsappUrl } from '@/lib/phone'
import { MEMBERSHIP_EXPIRY_ALERT_DAYS } from '@/lib/constants'
import Link from 'next/link'

export default async function DashboardPage() {
  await requireAuth()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const expiryThreshold = new Date(now.getTime() + MEMBERSHIP_EXPIRY_ALERT_DAYS * 24 * 60 * 60 * 1000)

  const [
    todayAppointments,
    rooms,
    cats,
    expiringMemberships,
    totalCustomers,
    pendingLeads,
  ] = await Promise.all([
    db.appointment.findMany({
      where: { scheduledAt: { gte: todayStart, lt: todayEnd }, status: { not: 'Cancelled' } },
      include: { customer: true, cat: true, room: true },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.cat.findMany({
      include: { customer: true, appointments: { select: { scheduledAt: true, status: true, type: true } } },
    }),
    db.membership.findMany({
      where: { status: 'Active', expiryDate: { lte: expiryThreshold } },
      include: { customer: true, tier: true },
      orderBy: { expiryDate: 'asc' },
    }),
    db.customer.count(),
    db.whatsAppLead.count({ where: { status: 'Pending' } }),
  ])

  const groomingReminders = buildGroomingPredictions(cats)
  const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">{now.toLocaleDateString('en-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Customers" value={totalCustomers} href="/customers" color="blue" />
        <StatCard label="Today's Appointments" value={todayAppointments.length} href="/appointments" color="rose" />
        <StatCard label="Rooms Occupied" value={`${occupiedRooms}/${rooms.length}`} href="/rooms" color="amber" />
        <StatCard label="Pending WhatsApp" value={pendingLeads} href="/whatsapp" color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Today&apos;s Appointments</h2>
            <Link href="/appointments/new" className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded-lg hover:bg-rose-700">+ Book</Link>
          </div>
          {todayAppointments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No appointments today</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {todayAppointments.map(appt => (
                <li key={appt.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {appt.cat.name} · <span className="text-gray-500">{appt.customer.name ?? appt.customer.phone}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {appt.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })} · {appt.type}
                      {appt.room && ` · ${appt.room.name}`}
                    </p>
                  </div>
                  <StatusBadge status={appt.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Room Occupancy</h2>
            <Link href="/rooms" className="text-xs text-rose-600 hover:underline">Manage</Link>
          </div>
          {rooms.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">
              No rooms set up yet · <Link href="/rooms/new" className="text-rose-600">Add room</Link>
            </p>
          ) : (
            <div className="p-5 grid grid-cols-3 gap-2">
              {rooms.map(room => (
                <div key={room.id} className={`rounded-lg px-3 py-2 text-xs font-medium border ${roomStatusClass(room.status)}`}>
                  <div className="font-semibold truncate">{room.name}</div>
                  <div className="opacity-70">{room.type} · {room.status}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">
              Grooming Reminders <span className="text-xs font-normal text-gray-400">next 7 days</span>
            </h2>
          </div>
          {groomingReminders.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No grooming due soon</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {groomingReminders.slice(0, 8).map(r => (
                <li key={r.catId} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {r.catName} · <span className="text-gray-500">{r.customerName ?? r.customerPhone}</span>
                    </p>
                    <p className={`text-xs ${r.isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                      {r.isOverdue ? `Overdue by ${Math.abs(r.daysUntilDue)}d` : `Due in ${r.daysUntilDue}d`}
                    </p>
                  </div>
                  <a
                    href={whatsappUrl(r.customerPhone, `Hi! Just a reminder that ${r.catName} is due for grooming. Would you like to book a session?`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700"
                  >
                    WhatsApp
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">
              Memberships Expiring <span className="text-xs font-normal text-gray-400">next 14 days</span>
            </h2>
            <Link href="/memberships" className="text-xs text-rose-600 hover:underline">All</Link>
          </div>
          {expiringMemberships.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No memberships expiring soon</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {expiringMemberships.map(m => (
                <li key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.customer.name ?? m.customer.phone}</p>
                    <p className="text-xs text-gray-400">
                      {m.tier.name} · expires {m.expiryDate.toLocaleDateString('en-MY')}
                    </p>
                  </div>
                  <a
                    href={whatsappUrl(m.customer.phone, `Hi! Your ${m.tier.name} membership is expiring on ${m.expiryDate.toLocaleDateString('en-MY')}. Would you like to renew?`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700"
                  >
                    Remind
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, href, color }: { label: string; value: number | string; href: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  }
  return (
    <Link href={href} className={`rounded-xl border p-4 flex flex-col gap-1 hover:opacity-80 transition-opacity ${colors[color]}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs font-medium opacity-80">{label}</span>
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    Scheduled: 'bg-blue-100 text-blue-700',
    CheckedIn: 'bg-amber-100 text-amber-700',
    Completed: 'bg-green-100 text-green-700',
    NoShow: 'bg-red-100 text-red-700',
    Cancelled: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${classes[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function roomStatusClass(status: string) {
  const map: Record<string, string> = {
    Available: 'bg-green-50 border-green-200 text-green-800',
    Occupied: 'bg-red-50 border-red-200 text-red-800',
    Cleaning: 'bg-amber-50 border-amber-200 text-amber-800',
    Maintenance: 'bg-gray-100 border-gray-200 text-gray-600',
  }
  return map[status] ?? 'bg-gray-50 border-gray-200 text-gray-600'
}
