import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildGroomingPredictions } from '@/lib/grooming-reminder'
import { whatsappUrl } from '@/lib/phone'
import { MEMBERSHIP_EXPIRY_ALERT_DAYS } from '@/lib/constants'
import { monthKey, monthLabel, computePacing, type SalesPacing } from '@/lib/plan'
import Link from 'next/link'

export default async function DashboardPage() {
  await requireAuth()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const expiryThreshold = new Date(now.getTime() + MEMBERSHIP_EXPIRY_ALERT_DAYS * 24 * 60 * 60 * 1000)

  const [
    todayAppointments,
    rooms,
    cats,
    expiringMemberships,
    totalCustomers,
    pendingLeads,
    plan,
    monthTarget,
    monthRevenueAgg,
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
    db.businessPlan.findUnique({ where: { id: 'default' } }),
    db.monthlyTarget.findUnique({ where: { month: monthKey(now) } }),
    db.transaction.aggregate({ _sum: { total: true }, where: { date: { gte: monthStart, lt: monthEnd } } }),
  ])

  const groomingReminders = buildGroomingPredictions(cats)
  const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length

  const monthRevenue = monthRevenueAgg._sum.total ?? 0
  const pacing = computePacing(monthTarget?.revenueTarget ?? 0, monthRevenue, plan?.avgSaleValue ?? 0, now)
  const hasPlan = (monthTarget?.revenueTarget ?? 0) > 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#2D1907' }}>Dashboard</h1>
        <p className="text-sm" style={{ color: '#729094' }}>{now.toLocaleDateString('en-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <BreakevenWidget hasPlan={hasPlan} pacing={pacing} monthName={monthLabel(monthKey(now))} hasAvgSale={(plan?.avgSaleValue ?? 0) > 0} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Customers" value={totalCustomers} href="/customers" color="blue" />
        <StatCard label="Today's Appointments" value={todayAppointments.length} href="/appointments" color="rose" />
        <StatCard label="Rooms Occupied" value={`${occupiedRooms}/${rooms.length}`} href="/rooms" color="amber" />
        <StatCard label="Pending WhatsApp" value={pendingLeads} href="/whatsapp" color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl overflow-hidden" style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(45,25,7,0.1)' }}>
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Today&apos;s Appointments</h2>
            <Link href="/appointments/new" className="text-xs px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity" style={{ background: '#B14919', color: '#ECDBB6' }}>+ Book</Link>
          </div>
          {todayAppointments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'rgba(45,25,7,0.4)' }}>No appointments today</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {todayAppointments.map(appt => (
                <li key={appt.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#2D1907' }}>
                      {appt.cat.name} · <span style={{ color: '#729094' }}>{appt.customer.name ?? appt.customer.phone}</span>
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(45,25,7,0.5)' }}>
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

        <section className="rounded-xl overflow-hidden" style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(45,25,7,0.1)' }}>
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Room Occupancy</h2>
            <Link href="/rooms" className="text-xs hover:underline" style={{ color: '#B14919' }}>Manage</Link>
          </div>
          {rooms.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'rgba(45,25,7,0.4)' }}>
              No rooms set up yet · <Link href="/rooms/new" style={{ color: '#B14919' }}>Add room</Link>
            </p>
          ) : (
            <div className="p-5 grid grid-cols-3 gap-2">
              {rooms.map(room => (
                <div key={room.id} className="rounded-lg px-3 py-2 text-xs font-medium" style={roomStatusStyle(room.status)}>
                  <div className="font-semibold truncate">{room.name}</div>
                  <div className="opacity-70">{room.type} · {room.status}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl overflow-hidden" style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(45,25,7,0.1)' }}>
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>
              Grooming Reminders <span className="text-xs font-normal" style={{ color: 'rgba(45,25,7,0.4)' }}>next 7 days</span>
            </h2>
          </div>
          {groomingReminders.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'rgba(45,25,7,0.4)' }}>No grooming due soon</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {groomingReminders.slice(0, 8).map(r => (
                <li key={r.catId} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#2D1907' }}>
                      {r.catName} · <span style={{ color: '#729094' }}>{r.customerName ?? r.customerPhone}</span>
                    </p>
                    <p className="text-xs" style={{ color: r.isOverdue ? '#B14919' : 'rgba(45,25,7,0.45)' }}>
                      {r.isOverdue ? `Overdue by ${Math.abs(r.daysUntilDue)}d` : `Due in ${r.daysUntilDue}d`}
                    </p>
                  </div>
                  <a
                    href={whatsappUrl(r.customerPhone, `Hi! Just a reminder that ${r.catName} is due for grooming. Would you like to book a session?`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
                    style={{ background: '#729094', color: '#F2EDE0' }}
                  >
                    WhatsApp
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl overflow-hidden" style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(45,25,7,0.1)' }}>
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>
              Memberships Expiring <span className="text-xs font-normal" style={{ color: 'rgba(45,25,7,0.4)' }}>next 14 days</span>
            </h2>
            <Link href="/memberships" className="text-xs hover:underline" style={{ color: '#B14919' }}>All</Link>
          </div>
          {expiringMemberships.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'rgba(45,25,7,0.4)' }}>No memberships expiring soon</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {expiringMemberships.map(m => (
                <li key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#2D1907' }}>{m.customer.name ?? m.customer.phone}</p>
                    <p className="text-xs" style={{ color: 'rgba(45,25,7,0.45)' }}>
                      {m.tier.name} · expires {m.expiryDate.toLocaleDateString('en-MY')}
                    </p>
                  </div>
                  <a
                    href={whatsappUrl(m.customer.phone, `Hi! Your ${m.tier.name} membership is expiring on ${m.expiryDate.toLocaleDateString('en-MY')}. Would you like to renew?`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
                    style={{ background: '#E7CE7A', color: '#2D1907' }}
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

function BreakevenWidget({ hasPlan, pacing, monthName, hasAvgSale }: {
  hasPlan: boolean; pacing: SalesPacing; monthName: string; hasAvgSale: boolean
}) {
  if (!hasPlan) {
    return (
      <Link href="/plan" className="cd-card p-5 flex items-center justify-between hover:opacity-90 transition-opacity">
        <div>
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Breakeven Tracker</h2>
          <p className="text-sm cd-muted">No revenue target set for {monthName}. Build the financial plan to see how many sales to close each week.</p>
        </div>
        <span className="cd-btn text-sm whitespace-nowrap">Set up plan →</span>
      </Link>
    )
  }

  const headline = pacing.salesPerWeek != null ? `${pacing.salesPerWeek}` : `RM ${Math.ceil(pacing.remaining / Math.max(1, pacing.weeksLeft)).toLocaleString()}`
  const headlineUnit = pacing.salesPerWeek != null ? (pacing.salesPerWeek === 1 ? 'sale / week' : 'sales / week') : '/ week'

  return (
    <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #2D1907 0%, #4a2d10 100%)' }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: '#E7CE7A', letterSpacing: '0.12em' }}>
            {monthName} · Breakeven Target
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-bold" style={{ color: '#F2EDE0' }}>{pacing.onTrack ? '✓' : headline}</span>
            {!pacing.onTrack && <span className="text-sm" style={{ color: 'rgba(236,219,182,0.8)' }}>{headlineUnit} to stay on track</span>}
            {pacing.onTrack && <span className="text-sm" style={{ color: '#E7CE7A' }}>Target met for {monthName}</span>}
          </div>
        </div>
        <Link href="/plan" className="text-xs px-3 py-1.5 rounded-lg whitespace-nowrap" style={{ background: 'rgba(236,219,182,0.15)', color: '#ECDBB6' }}>
          Edit plan →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <WidgetMetric label="Booked this month" value={`RM ${pacing.actualRevenue.toLocaleString()}`} />
        <WidgetMetric label="Monthly target" value={`RM ${pacing.targetRevenue.toLocaleString()}`} />
        <WidgetMetric label="Remaining" value={`RM ${pacing.remaining.toLocaleString()}`} />
        <WidgetMetric label={pacing.salesToClose != null ? 'Sales still to close' : 'Weeks left'}
          value={pacing.salesToClose != null ? `${pacing.salesToClose}` : `${pacing.weeksLeft}`} />
      </div>

      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(236,219,182,0.15)' }}>
        <div className="h-full rounded-full" style={{ width: `${pacing.pct}%`, background: pacing.onTrack ? '#729094' : '#E7CE7A' }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs" style={{ color: 'rgba(236,219,182,0.7)' }}>{pacing.pct}% of target</span>
        {!hasAvgSale && (
          <Link href="/plan" className="text-xs" style={{ color: '#E7CE7A' }}>Set avg sale value to see sales counts →</Link>
        )}
      </div>
    </div>
  )
}

function WidgetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold" style={{ color: '#F2EDE0' }}>{value}</div>
      <div className="text-xs" style={{ color: 'rgba(236,219,182,0.65)' }}>{label}</div>
    </div>
  )
}

function StatCard({ label, value, href, color }: { label: string; value: number | string; href: string; color: string }) {
  const styles: Record<string, React.CSSProperties> = {
    blue:  { background: '#2D1907', color: '#ECDBB6', borderColor: 'transparent' },
    rose:  { background: '#B14919', color: '#ECDBB6', borderColor: 'transparent' },
    amber: { background: '#E7CE7A', color: '#2D1907', borderColor: 'transparent' },
    green: { background: '#729094', color: '#ECDBB6', borderColor: 'transparent' },
  }
  return (
    <Link href={href} className="rounded-xl border p-4 flex flex-col gap-1 hover:opacity-85 transition-opacity" style={styles[color]}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs font-medium opacity-80">{label}</span>
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, React.CSSProperties> = {
    Scheduled:  { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    CheckedIn:  { background: 'rgba(231,206,122,0.35)', color: '#8a6c00' },
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.45)' },
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={styles[status] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.45)' }}>
      {status}
    </span>
  )
}

function roomStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    Available:   { background: 'rgba(114,144,148,0.18)', color: '#2D1907', border: '1px solid rgba(114,144,148,0.3)' },
    Occupied:    { background: 'rgba(177,73,25,0.15)', color: '#B14919', border: '1px solid rgba(177,73,25,0.25)' },
    Cleaning:    { background: 'rgba(231,206,122,0.35)', color: '#7a5c00', border: '1px solid rgba(231,206,122,0.5)' },
    Maintenance: { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' },
  }
  return map[status] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }
}
