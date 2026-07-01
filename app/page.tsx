import { requireAuth } from '@/lib/auth'
import { getDashboardData } from '@/lib/dashboard'
import { whatsappUrl } from '@/lib/phone'
import { REVENUE_CATEGORIES } from '@/lib/constants'
import { type SalesPacing } from '@/lib/plan'
import Link from 'next/link'

const STREAM_COLORS: Record<string, string> = {
  Grooming: '#B14919', Boarding: '#729094', Retail: '#9c6b3f',
  Membership: '#B8902B', Academy: '#2D1907', Other: '#a89878',
}

export default async function DashboardPage() {
  await requireAuth()
  const d = await getDashboardData()
  const { now, revenue, ops, customer, alerts, panels, breakeven } = d

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#2D1907' }}>Dashboard</h1>
        <p className="text-sm" style={{ color: '#729094' }}>{now.toLocaleDateString('en-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <BreakevenWidget hasPlan={breakeven.hasPlan} pacing={breakeven.pacing} monthName={breakeven.monthName} hasAvgSale={breakeven.hasAvgSale} />

      {/* ── Revenue by stream ── */}
      <section className="cd-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Revenue</h2>
          <div className="flex gap-6">
            <div className="text-right">
              <div className="text-xs cd-muted">Today</div>
              <div className="text-xl font-bold" style={{ color: '#2D1907' }}>RM {revenue.totalToday.toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-xs cd-muted">This month</div>
              <div className="text-xl font-bold" style={{ color: '#B14919' }}>RM {revenue.totalMonth.toLocaleString()}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {REVENUE_CATEGORIES.map(cat => (
            <div key={cat} className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(45,25,7,0.04)', borderLeft: `3px solid ${STREAM_COLORS[cat]}` }}>
              <div className="text-xs cd-muted">{cat}</div>
              <div className="text-base font-bold" style={{ color: '#2D1907' }}>RM {(revenue.month[cat] ?? 0).toLocaleString()}</div>
              <div className="text-xs cd-muted">today RM {(revenue.today[cat] ?? 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Operations ── */}
      <section>
        <SectionTitle>Operations</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Cats boarding" value={ops.catsBoarding} accent="#729094" href="/rooms" />
          <Tile label="Grooming today" value={ops.groomingToday} accent="#B14919" href="/appointments" />
          <Tile label="Occupancy" value={`${ops.occupancyPct}%`} sub={`${ops.occupiedRooms}/${ops.totalRooms} rooms`} accent="#2D1907" href="/rooms" />
          <Tile label="Rooms free" value={ops.availableRooms} accent="#729094" href="/rooms" />
          <Tile label="Safety incidents" value={ops.safetyOpen} accent={ops.safetyOpen > 0 ? '#B14919' : '#2D1907'} href="/incidents" />
          <Tile label="Complaints" value={ops.complaintsOpen} accent={ops.complaintsOpen > 0 ? '#B14919' : '#2D1907'} href="/incidents" />
        </div>
      </section>

      {/* ── Customer signals ── */}
      <section>
        <SectionTitle>Customers</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="New this month" value={customer.newCustomers} accent="#729094" href="/customers" />
          <Tile label="Returning" value={customer.returningCustomers} accent="#2D1907" href="/customers" />
          <Tile label="New memberships" value={customer.monthConversions} accent="#B8902B" href="/memberships" />
          <Tile label="Birthdays today" value={customer.birthdaysToday.length} accent="#B14919" href="/cats" />
          <Tile label="Cats due grooming" value={customer.catsDue.length} accent="#B14919" href="/cats" />
          <Tile label="Total customers" value={customer.totalCustomers} accent="#2D1907" href="/customers" />
        </div>
      </section>

      {/* ── Alerts ── */}
      <section>
        <SectionTitle>Alerts</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AlertCard title="VIP arriving today" count={alerts.vipArriving.length} accent="#B8902B">
            {alerts.vipArriving.length === 0 ? <Empty>No VIP appointments today</Empty> : alerts.vipArriving.map(a => (
              <AlertRow key={a.id}
                main={`${a.cat.name} · ${a.customer.name ?? a.customer.phone}`}
                sub={`${a.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })} · ${a.type}`}
                href={`/customers/${a.customerId}`} />
            ))}
          </AlertCard>

          <AlertCard title="Vaccinations expiring" count={alerts.vaccinationsExpiring.length} accent="#B14919">
            {alerts.vaccinationsExpiring.length === 0 ? <Empty>None expiring in 30 days</Empty> : alerts.vaccinationsExpiring.slice(0, 8).map(c => (
              <AlertRow key={c.id}
                main={`${c.name} · ${c.customer.name ?? c.customer.phone}`}
                sub={`expires ${c.vaccinationExpiry!.toLocaleDateString('en-MY')}`}
                action={{ href: whatsappUrl(c.customer.phone, `Hi! ${c.name}'s vaccination expires on ${c.vaccinationExpiry!.toLocaleDateString('en-MY')}. Let's schedule a top-up.`), label: 'WhatsApp' }} />
            ))}
          </AlertCard>

          <AlertCard title="Boarding check-outs today" count={alerts.checkouts.length} accent="#729094">
            {alerts.checkouts.length === 0 ? <Empty>No check-outs today</Empty> : alerts.checkouts.map(a => (
              <AlertRow key={a.id}
                main={`${a.cat.name} · ${a.customer.name ?? a.customer.phone}`}
                sub={`${a.room?.name ?? 'Room —'} · out ${a.endsAt?.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }) ?? ''}`}
                href={`/appointments/${a.id}`} />
            ))}
          </AlertCard>

          <AlertCard title="Outstanding payments" count={alerts.outstanding.length} accent="#B14919">
            {alerts.outstanding.length === 0 ? <Empty>All settled</Empty> : alerts.outstanding.map(a => (
              <AlertRow key={a.id}
                main={`${a.cat.name} · ${a.customer.name ?? a.customer.phone}`}
                sub={`${a.type} · ${a.scheduledAt.toLocaleDateString('en-MY')}`}
                right={a.price != null ? `RM ${a.price.toFixed(2)}` : undefined}
                href={`/appointments/${a.id}`} />
            ))}
          </AlertCard>
        </div>
        <p className="text-xs cd-muted mt-2">Low-inventory alerts arrive with the Inventory module (Phase 4).</p>
      </section>

      {/* ── Existing operational panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="cd-card overflow-hidden">
          <div className="cd-section-header">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Today&apos;s Appointments</h2>
            <Link href="/appointments/new" className="text-xs px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity" style={{ background: '#B14919', color: '#ECDBB6' }}>+ Book</Link>
          </div>
          {panels.todayAppointments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center cd-muted">No appointments today</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {panels.todayAppointments.map(appt => (
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

        <section className="cd-card overflow-hidden">
          <div className="cd-section-header">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Room Occupancy</h2>
            <Link href="/rooms" className="text-xs hover:underline" style={{ color: '#B14919' }}>Manage</Link>
          </div>
          {panels.rooms.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center cd-muted">
              No rooms set up yet · <Link href="/rooms/new" style={{ color: '#B14919' }}>Add room</Link>
            </p>
          ) : (
            <div className="p-5 grid grid-cols-3 gap-2">
              {panels.rooms.map(room => (
                <div key={room.id} className="rounded-lg px-3 py-2 text-xs font-medium" style={roomStatusStyle(room.status)}>
                  <div className="font-semibold truncate">{room.name}</div>
                  <div className="opacity-70">{room.type} · {room.status}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cd-card overflow-hidden">
          <div className="cd-section-header">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>
              Grooming Reminders <span className="text-xs font-normal cd-muted">next 7 days</span>
            </h2>
          </div>
          {panels.groomingReminders.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center cd-muted">No grooming due soon</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {panels.groomingReminders.slice(0, 8).map(r => (
                <li key={r.catId} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#2D1907' }}>
                      {r.catName} · <span style={{ color: '#729094' }}>{r.customerName ?? r.customerPhone}</span>
                    </p>
                    <p className="text-xs" style={{ color: r.isOverdue ? '#B14919' : 'rgba(45,25,7,0.45)' }}>
                      {r.isOverdue ? `Overdue by ${Math.abs(r.daysUntilDue)}d` : `Due in ${r.daysUntilDue}d`}
                    </p>
                  </div>
                  <a href={whatsappUrl(r.customerPhone, `Hi! Just a reminder that ${r.catName} is due for grooming. Would you like to book a session?`)}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity" style={{ background: '#729094', color: '#F2EDE0' }}>
                    WhatsApp
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cd-card overflow-hidden">
          <div className="cd-section-header">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>
              Memberships Expiring <span className="text-xs font-normal cd-muted">next 14 days</span>
            </h2>
            <Link href="/memberships" className="text-xs hover:underline" style={{ color: '#B14919' }}>All</Link>
          </div>
          {panels.expiringMemberships.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center cd-muted">No memberships expiring soon</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
              {panels.expiringMemberships.map(m => (
                <li key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#2D1907' }}>{m.customer.name ?? m.customer.phone}</p>
                    <p className="text-xs cd-muted">{m.tier.name} · expires {m.expiryDate.toLocaleDateString('en-MY')}</p>
                  </div>
                  <a href={whatsappUrl(m.customer.phone, `Hi! Your ${m.tier.name} membership is expiring on ${m.expiryDate.toLocaleDateString('en-MY')}. Would you like to renew?`)}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity" style={{ background: '#E7CE7A', color: '#2D1907' }}>
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

// ── Small presentational helpers ──

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>{children}</h2>
}

function Tile({ label, value, sub, accent, href }: { label: string; value: number | string; sub?: string; accent: string; href?: string }) {
  const inner = (
    <>
      <span className="text-2xl font-bold" style={{ color: accent }}>{value}</span>
      <span className="text-xs cd-muted">{label}</span>
      {sub && <span className="text-xs cd-muted opacity-70">{sub}</span>}
    </>
  )
  const cls = 'cd-card px-4 py-3 flex flex-col gap-0.5 hover:opacity-90 transition-opacity'
  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}

function AlertCard({ title, count, accent, children }: { title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <div className="cd-card overflow-hidden">
      <div className="cd-section-header">
        <h3 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{title}</h3>
        {count > 0 && <span className="cd-pill text-white" style={{ background: accent }}>{count}</span>}
      </div>
      <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>{children}</ul>
    </div>
  )
}

function AlertRow({ main, sub, right, href, action }: {
  main: string; sub?: string; right?: string; href?: string
  action?: { href: string; label: string }
}) {
  const body = (
    <div className="min-w-0">
      <p className="text-sm font-medium truncate" style={{ color: '#2D1907' }}>{main}</p>
      {sub && <p className="text-xs cd-muted truncate">{sub}</p>}
    </div>
  )
  return (
    <li className="px-5 py-2.5 flex items-center justify-between gap-3">
      {href ? <Link href={href} className="min-w-0 flex-1 hover:opacity-80">{body}</Link> : <div className="min-w-0 flex-1">{body}</div>}
      {right && <span className="text-sm font-medium whitespace-nowrap" style={{ color: '#B14919' }}>{right}</span>}
      {action && (
        <a href={action.href} target="_blank" rel="noopener noreferrer"
          className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity whitespace-nowrap" style={{ background: '#729094', color: '#F2EDE0' }}>
          {action.label}
        </a>
      )}
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-5 py-6 text-sm text-center cd-muted">{children}</li>
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
