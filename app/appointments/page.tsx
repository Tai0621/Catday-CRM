import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES, RESIDENCY_TYPE } from '@/lib/constants'
import { apptTypeStyle } from '@/lib/segments'
import { getConfig } from '@/lib/config'
import { zonedDayKey, zonedDayStart, zonedDayRange } from '@/lib/timezone'
import { groupByDay, relativeDayLabel, zonedTime, isChangeable } from '@/lib/appointments/schedule'
import { DatePicker } from './DatePicker'
import { AppointmentActions } from './AppointmentActions'

// The diary.
//
// This used to open on a single day and make the owner page through dates to
// find anything. It now opens on everything still to come, grouped under its
// own date, because "what is coming up" is the question being asked almost
// every time the page is opened — the single-day view is still here, but it is
// now something you choose rather than something you escape.
//
// Bounded on purpose: "all appointments" grows without limit and a diary that
// takes four seconds to open is one nobody keeps current. Upcoming is capped,
// and the cap is stated on screen rather than silently truncating.
const UPCOMING_LIMIT = 300
const PAST_LIMIT = 100

type View = 'upcoming' | 'past' | 'day'

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; type?: string; status?: string; view?: string }>
}) {
  await requireAuth()
  const { date, type, status, view: viewParam } = await searchParams

  const { timezone } = await getConfig()
  const todayKey = zonedDayKey(new Date(), timezone)

  // A date in the URL means someone asked for that day; otherwise the view
  // parameter decides, and the default is what is still to come.
  const view: View = date ? 'day' : viewParam === 'past' ? 'past' : 'upcoming'

  // Residencies are house cats living in rooms, not diary entries. They belong
  // to the run sheet and the room calendar; here they would be permanent rows
  // that never complete and can never be actioned.
  const where: Record<string, unknown> = { type: { not: RESIDENCY_TYPE } }
  if (type) where.type = type
  if (status) where.status = status

  if (view === 'day') {
    const { start, end } = zonedDayRange(date!, timezone)
    where.scheduledAt = { gte: start, lt: end }
  } else if (view === 'past') {
    where.scheduledAt = { lt: zonedDayStart(todayKey, timezone) }
  } else {
    where.scheduledAt = { gte: zonedDayStart(todayKey, timezone) }
  }

  const appointments = await db.appointment.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      cat: { select: { id: true, name: true } },
      room: { select: { name: true } },
      service: { select: { name: true, durationMin: true, price: true } },
    },
    orderBy: { scheduledAt: view === 'past' ? 'desc' : 'asc' },
    take: view === 'past' ? PAST_LIMIT : view === 'upcoming' ? UPCOMING_LIMIT : 500,
  })

  const groups = groupByDay(appointments, timezone)
  const dayKey = date ?? todayKey
  const prevDay = shift(dayKey, -1)
  const nextDay = shift(dayKey, 1)

  // Filters must survive a change of view, or narrowing to "Boarding" and then
  // looking at yesterday silently shows everything again.
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (type) p.set('type', type)
    if (status) p.set('status', status)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    return `?${p.toString()}`
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Appointments</h1>
        <Link href="/appointments/new" className="cd-btn">+ Book</Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          <ViewTab href={keep({ view: 'upcoming' })} active={view === 'upcoming'}>Upcoming</ViewTab>
          <ViewTab href={keep({ view: 'past' })} active={view === 'past'}>Past</ViewTab>
          <ViewTab href={keep({ date: todayKey })} active={view === 'day'}>By day</ViewTab>
        </div>

        {view === 'day' && (
          <div className="flex items-center gap-1">
            <Link href={keep({ date: prevDay })} className="px-2 py-1 text-sm cd-btn-sec rounded">←</Link>
            <DatePicker defaultValue={dayKey} />
            <Link href={keep({ date: nextDay })} className="px-2 py-1 text-sm cd-btn-sec rounded">→</Link>
          </div>
        )}

        <form className="flex gap-2">
          {view === 'day' && <input type="hidden" name="date" value={dayKey} />}
          {view !== 'day' && <input type="hidden" name="view" value={view} />}
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

      {groups.length === 0 && (
        <div className="cd-card px-4 py-10 text-center cd-muted text-sm">
          {view === 'upcoming' ? 'Nothing booked from today onwards.'
            : view === 'past' ? 'No past appointments match.'
            : 'No appointments on this day.'}
        </div>
      )}

      {groups.map(group => (
        <section key={group.dayKey} className="space-y-1.5">
          <DayHeading dayKey={group.dayKey} todayKey={todayKey} count={group.items.length} timezone={timezone} />
          <div className="cd-card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead">
                <th>Time</th><th>Cat</th><th>Customer</th><th>Type</th>
                <th>Room</th><th>Status</th><th>Price</th><th></th>
              </tr></thead>
              <tbody className="cd-tbody">
                {group.items.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: '#2D1907' }}>
                      {zonedTime(a.scheduledAt, timezone)}
                      {a.type === 'Boarding' && a.endsAt && (
                        <span className="cd-muted font-normal"> → {zonedDayKey(a.endsAt, timezone).slice(5)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: '#2D1907' }}>{a.cat.name}</td>
                    <td className="px-4 py-3 cd-muted">{a.customer.name ?? a.customer.phone}</td>
                    <td className="px-4 py-3">
                      <span className="cd-pill" style={apptTypeStyle(a.type)}>{a.type}</span>
                    </td>
                    <td className="px-4 py-3 cd-muted">{a.room?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="cd-pill" style={apptStatusStyle(a.status)}>{a.status}</span>
                      {a.rescheduledAt && (
                        <span className="text-xs cd-muted block mt-0.5">moved</span>
                      )}
                    </td>
                    <td className="px-4 py-3 cd-muted whitespace-nowrap">
                      {a.price != null ? `RM ${a.price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Link href={`/appointments/${a.id}`} className="text-xs cd-link">View</Link>
                        {isChangeable(a.status) && (
                          <AppointmentActions
                            appointment={{
                              id: a.id,
                              type: a.type,
                              catName: a.cat.name,
                              status: a.status,
                              scheduledAt: a.scheduledAt.toISOString(),
                              endsAt: a.endsAt?.toISOString() ?? null,
                              price: a.price,
                              roomId: a.roomId,
                              depositRM: a.depositRM,
                              serviceName: a.service?.name ?? null,
                              durationMin: a.service?.durationMin ?? null,
                              unitPrice: a.service?.price ?? null,
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {view === 'upcoming' && appointments.length === UPCOMING_LIMIT && (
        <p className="text-xs cd-muted text-center">
          Showing the next {UPCOMING_LIMIT} appointments — use <strong>By day</strong> to look further ahead.
        </p>
      )}
      {view === 'past' && appointments.length === PAST_LIMIT && (
        <p className="text-xs cd-muted text-center">
          Showing the {PAST_LIMIT} most recent — use <strong>By day</strong> for a specific date.
        </p>
      )}
    </div>
  )
}

function shift(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function DayHeading({
  dayKey, todayKey, count, timezone,
}: { dayKey: string; todayKey: string; count: number; timezone: string }) {
  const relative = relativeDayLabel(dayKey, todayKey)
  const full = new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: timezone,
  })
  const isToday = dayKey === todayKey
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <h2 className="text-sm font-semibold" style={{ color: isToday ? '#B14919' : '#2D1907' }}>
        {relative ?? full}
      </h2>
      {relative && <span className="text-xs cd-muted">{full}</span>}
      <span className="text-xs cd-muted">· {count} booking{count === 1 ? '' : 's'}</span>
    </div>
  )
}

function apptStatusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Scheduled:  { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    CheckedIn:  { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    InService:  { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    QualityCheck: { background: 'rgba(231,206,122,0.5)', color: '#7a5c00' },
    Ready:      { background: 'rgba(122,138,79,0.22)', color: '#5c6b3c' },
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}

function ViewTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="px-3 py-1.5 text-sm rounded-lg transition-colors"
      style={active
        ? { background: '#B14919', color: '#F2EDE0' }
        : { background: '#F2EDE0', color: '#2D1907', border: '1px solid rgba(45,25,7,0.15)' }}>
      {children}
    </Link>
  )
}
