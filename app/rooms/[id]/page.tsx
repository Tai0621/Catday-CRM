import { requireAuth, getSession, isManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getConfig } from '@/lib/config'
import { zonedDayKey, zonedDayRange } from '@/lib/timezone'
import { logRedFlags } from '@/lib/care-log'
import { mealsPerDayFor } from '@/lib/health'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { RESIDENCY_TYPE } from '@/lib/constants'
import { GLASS } from '@/app/components/CabinetUnit'
import { TaskCheck } from '@/app/components/Pending'

const DAY = 24 * 60 * 60 * 1000
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—')

// A room, opened from the wall.
//
// This used to be the edit form — name, type, capacity, sort order. That is a
// settings page, and it is the wrong thing to land on when a carer taps a cat.
// The stay comes first and today's care list is HERE rather than a link to the
// run sheet, because the work has to be doable where the question was asked.
export default async function RoomPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const session = await requireAuth()
  const { id } = await params
  const { date } = await searchParams
  const { timezone, business } = await getConfig()

  const now = new Date()
  const todayKey = zonedDayKey(now, timezone)
  const viewKey = date ?? todayKey
  const isToday = viewKey === todayKey

  const room = await db.room.findUnique({
    where: { id },
    include: { zone: { select: { code: true, name: true, kind: true } } },
  })
  if (!room) notFound()

  const { start: dayStart, end: dayEnd } = zonedDayRange(viewKey, timezone)

  const [stay, upcoming] = await Promise.all([
    // The stay covering THIS DAY — the same window the wall uses. Taking the
    // earliest un-completed booking instead showed a stale Scheduled row from
    // last week while the wall showed the cat actually in the room, and the two
    // screens disagreeing about who is behind a door is worse than either being
    // wrong on its own.
    db.appointment.findFirst({
      where: {
        roomId: id,
        type: { in: ['Boarding', RESIDENCY_TYPE] },
        status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { lt: dayEnd },
        OR: [{ endsAt: { gte: dayStart } }, { endsAt: null }],
      },
      include: {
        cat: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.appointment.findMany({
      where: {
        roomId: id, type: 'Boarding', status: 'Scheduled',
        scheduledAt: { gt: now },
      },
      select: { id: true, scheduledAt: true, endsAt: true, cat: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
    }),
  ])

  const [tasks, logs] = stay
    ? await Promise.all([
        db.careTask.findMany({ where: { appointmentId: stay.id, date: todayKey }, orderBy: { createdAt: 'asc' } }),
        db.dailyCareLog.findMany({ where: { appointmentId: stay.id, date: todayKey } }),
      ])
    : [[], []]

  const flags = [...new Set(logs.flatMap(l => logRedFlags(l)))]
  const done = tasks.filter(t => t.done).length
  const g = GLASS[stay ? 'Occupied' : room.status] ?? GLASS.Available
  const manager = isManager(session)
  const isResidency = stay?.type === RESIDENCY_TYPE
  const nights = stay?.endsAt ? Math.max(0, Math.round((stay.endsAt.getTime() - stay.scheduledAt.getTime()) / DAY)) : null
  const left = stay?.endsAt ? Math.max(0, Math.ceil((stay.endsAt.getTime() - now.getTime()) / DAY)) : null

  async function toggleTask(data: FormData) {
    'use server'
    const taskId = data.get('id') as string
    const t = await db.careTask.findUnique({ where: { id: taskId } })
    if (!t) return
    const s = await getSession()
    await db.careTask.update({
      where: { id: taskId },
      data: t.done
        ? { done: false, doneAt: null, staffId: null }
        : { done: true, doneAt: new Date(), staffId: s?.kind === 'staff' ? s.staffId : null },
    })
    revalidatePath(`/rooms/${id}`)
    revalidatePath('/rooms')
    revalidatePath('/runsheet')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <Link href={isToday ? '/rooms' : `/rooms?date=${viewKey}`} className="text-xs cd-muted hover:underline">← Boarding Wall</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>
            {stay ? stay.cat.name : room.name}
          </h1>
          <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)', fontFamily: 'var(--font-brand)' }}>
            {room.name}
          </span>
          <span className="cd-pill" style={{ background: g.chip, color: g.pill }}>
            {stay ? (isResidency ? 'Resident' : 'In house') : room.status}
          </span>
          {room.zone && <span className="text-xs cd-muted">{room.zone.code} · {room.zone.name}</span>}
          <span className="flex-grow" />
          {stay?.endsAt && (
            <span className="text-xs cd-muted">
              {nights} night{nights === 1 ? '' : 's'} · out {day(stay.endsAt)}
            </span>
          )}
        </div>
        {stay && (
          <p className="text-sm cd-muted mt-1">
            {[stay.cat.breed, stay.cat.gender, stay.cat.lifeStage].filter(Boolean).join(' · ')}
            {!isResidency && <> · owner {stay.customer.name ?? displayPhone(stay.customer.phone)}</>}
            {' · '}
            <Link href={`/cats/${stay.catId}`} className="cd-link">cat record</Link>
          </p>
        )}
      </div>

      {/* The flag comes first — it is usually why someone opened this room. */}
      {flags.length > 0 && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start"
          style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.28)' }}>
          <span style={{ color: '#B14919', fontWeight: 700 }}>!</span>
          <div className="flex-grow">
            <div className="text-sm font-semibold" style={{ color: '#8d3a14' }}>
              {flags.join(' · ')}
            </div>
            <div className="text-xs cd-muted mt-0.5">Raised on today&rsquo;s care log.</div>
          </div>
          {!isResidency && stay && (
            <a href={whatsappUrl(stay.customer.phone, `Hi, a quick update on ${stay.cat.name} from ${business.name}.`)}
              target="_blank" rel="noopener noreferrer" className="cd-btn-sec text-xs whitespace-nowrap">
              Message owner
            </a>
          )}
        </div>
      )}

      {stay ? (
        <div className="grid md:grid-cols-[1fr_300px] gap-4 items-start">
          {/* Today's care, tickable here */}
          <div className="cd-card overflow-hidden">
            <div className="cd-section-header">
              <span className="font-semibold" style={{ color: '#2D1907' }}>Today&rsquo;s care</span>
              <span className="text-sm cd-muted">{done} of {tasks.length} done</span>
            </div>
            {tasks.length === 0 ? (
              <p className="px-4 py-6 text-sm cd-muted text-center">
                No tasks generated yet — open the <Link href="/runsheet" className="cd-link">run sheet</Link> once and they appear.
              </p>
            ) : (
              <div className="p-2">
                {tasks.map(t => (
                  <form key={t.id} action={toggleTask}>
                    <input type="hidden" name="id" value={t.id} />
                    <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg"
                      style={{ background: t.done ? 'transparent' : 'rgba(177,73,25,0.05)' }}>
                      <TaskCheck done={t.done} color="#7A8A4F" />
                      <span className="text-sm" style={t.done
                        ? { color: 'rgba(45,25,7,0.45)', textDecoration: 'line-through' }
                        : { color: '#2D1907', fontWeight: 500 }}>
                        {t.task}
                      </span>
                      <span className="flex-grow" />
                      {t.doneAt && <span className="text-xs cd-muted">{t.doneAt.toISOString().slice(11, 16)}</span>}
                    </div>
                  </form>
                ))}
              </div>
            )}
            <div className="px-4 py-3 flex gap-2 flex-wrap" style={{ borderTop: '1px solid rgba(45,25,7,0.1)' }}>
              <Link href={`/runsheet/${stay.id}/log`} className="cd-btn text-sm">Log a round</Link>
              {!isResidency && <Link href={`/runsheet/${stay.id}/checkout`} className="cd-btn-sec text-sm">Check out</Link>}
              <Link href="/runsheet" className="cd-btn-sec text-sm">Run sheet</Link>
            </div>
          </div>

          {/* What a carer needs without leaving the page */}
          <div className="space-y-3">
            <div className="cd-card p-4">
              <div className="cd-label">Feeding &amp; medication</div>
              <dl className="text-sm space-y-1.5">
                <Row k="Diet" v={stay.cat.dietType ?? 'Not recorded'} />
                <Row k="Meals" v={`${mealsPerDayFor(stay.cat)} a day${stay.cat.portion ? ` · ${stay.cat.portion}` : ''}`} />
                {stay.cat.medication && <Row k="Medication" v={stay.cat.medication} />}
              </dl>
              {(stay.cat.feedingNotes || stay.cat.careNotes) && (
                <p className="text-xs cd-muted mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(45,25,7,0.1)', lineHeight: 1.5 }}>
                  {[stay.cat.feedingNotes, stay.cat.careNotes].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            <div className="cd-card p-4">
              <div className="cd-label">The stay</div>
              <dl className="text-sm space-y-1.5">
                <Row k="In" v={day(stay.scheduledAt)} />
                <Row k="Out" v={stay.endsAt ? day(stay.endsAt) : 'open-ended'} />
                {left != null && <Row k="Nights left" v={String(left)} />}
                {!isResidency && (
                  <Row k="Balance"
                    v={stay.paid ? 'Paid' : stay.price ? `RM ${stay.price.toLocaleString('en-MY', { maximumFractionDigits: 0 })} due` : 'Not priced'}
                    accent={!stay.paid} />
                )}
              </dl>
              {!isResidency && (
                <Link href={`/pos?customerId=${stay.customerId}`} className="cd-btn-sec text-sm inline-block mt-3">Take payment</Link>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="cd-card p-5 space-y-3">
          <p className="text-sm cd-muted">
            {room.status === 'Cleaning'
              ? 'Being turned over. Mark it ready on the list view when the clean is done.'
              : room.status === 'Maintenance'
                ? 'Out of service — it cannot be booked while it sits here.'
                : room.zone?.kind === 'Staging'
                  ? 'Empty. This is a staging cubby — somewhere to hold a cat between arriving and its room being ready, or after check-out. It never takes a booking.'
                  : 'Empty and ready. Nothing is in it today.'}
          </p>
          {upcoming.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: 'rgba(114,144,148,0.14)', border: '1px solid rgba(114,144,148,0.3)' }}>
              <div className="cd-label">Next booked</div>
              {upcoming.map(u => (
                <div key={u.id} className="text-sm">
                  {day(u.scheduledAt)} — {u.cat.name}
                  {u.endsAt && <span className="cd-muted"> · to {day(u.endsAt)}</span>}
                </div>
              ))}
            </div>
          )}
          {room.zone?.kind !== 'Staging' && (
            <Link href="/appointments/new" className="cd-btn inline-block">Book a stay here</Link>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs">
        <span className="cd-muted">
          Holds {room.capacity} · {room.type}
        </span>
        <span className="flex-grow" />
        {manager && <Link href={`/rooms/${room.id}/settings`} className="cd-link">Room settings</Link>}
        <Link href="/rooms" className="cd-link">Back to the wall</Link>
      </div>
    </div>
  )
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="cd-muted whitespace-nowrap">{k}</dt>
      <dd className="text-right font-medium" style={accent ? { color: '#B14919' } : undefined}>{v}</dd>
    </div>
  )
}
