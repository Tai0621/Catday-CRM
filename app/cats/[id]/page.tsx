import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { FOUNDER_CIRCLE_LIMIT } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { MediaSection } from '@/app/components/MediaSection'
import { listMediaFor } from '@/lib/media'
import { GROOM_MEDIA_TAGS, GROOMING_APPT_TYPES } from '@/lib/constants'
import { boardingHealthGate, mealsPerDayFor, type HealthStatus } from '@/lib/health'
import { SubmitButton } from '@/app/components/Pending'

export default async function CatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const cat = await db.cat.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          memberships: { where: { status: 'Active' }, include: { tier: true }, take: 1 },
        },
      },
      appointments: { orderBy: { scheduledAt: 'desc' }, include: { room: true } },
      assessments: { orderBy: { createdAt: 'desc' }, take: 8 },
    },
  })
  if (!cat) notFound()

  // Next free Founding Cat number (CAT-001…100)
  const takenNumbers = (await db.cat.findMany({
    where: { foundingNumber: { not: null } },
    select: { foundingNumber: true },
  })).map(c => c.foundingNumber!)
  const nextFounding = (() => {
    for (let n = 1; n <= FOUNDER_CIRCLE_LIMIT; n++) if (!takenNumbers.includes(n)) return n
    return null
  })()

  async function setVaccination(data: FormData) {
    'use server'
    const v = data.get('vaccinationExpiry') as string
    await db.cat.update({ where: { id }, data: { vaccinationExpiry: v ? new Date(v) : null } })
    redirect(`/cats/${id}`)
  }

  async function markDeworm() {
    'use server'
    await db.cat.update({ where: { id }, data: { lastDewormAt: new Date() } })
    redirect(`/cats/${id}`)
  }

  async function markDeflea() {
    'use server'
    await db.cat.update({ where: { id }, data: { lastDefleaAt: new Date() } })
    redirect(`/cats/${id}`)
  }

  async function setFoundingNumber(data: FormData) {
    'use server'
    const raw = (data.get('foundingNumber') as string) || ''
    const n = parseInt(raw, 10)
    const value = Number.isFinite(n) && n >= 1 && n <= FOUNDER_CIRCLE_LIMIT ? n : null
    try {
      await db.cat.update({ where: { id }, data: { foundingNumber: value } })
    } catch {
      // number already taken — leave unchanged
    }
    redirect(`/cats/${id}`)
  }

  const gate = boardingHealthGate(cat)
  const meals = mealsPerDayFor(cat)
  // Latest grooming visit's before/after — read-only gallery, only when it has media.
  const latestGroomAppt = cat.appointments.find(
    a => (GROOMING_APPT_TYPES as readonly string[]).includes(a.type) && a.status !== 'Cancelled' && a.status !== 'NoShow',
  )
  const groomMedia = latestGroomAppt ? await listMediaFor('appointment', latestGroomAppt.id) : []
  const lastGroomed = cat.appointments.find(a => a.type === 'Grooming' && a.status === 'Completed')?.scheduledAt ?? null
  const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval, cat.coatType)
  const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)
  const overdue = daysUntil < 0
  const activeMembership = cat.customer.memberships[0]

  const groomingStyle: React.CSSProperties = overdue
    ? { background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.25)', color: '#B14919' }
    : daysUntil <= 7
    ? { background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)', color: '#7a5c00' }
    : { background: 'rgba(114,144,148,0.15)', border: '1px solid rgba(114,144,148,0.3)', color: '#729094' }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Link href="/cats" className="text-xs cd-muted hover:underline">Cats</Link>
            <span className="text-xs cd-muted">›</span>
            <Link href={`/customers/${cat.customerId}`} className="text-xs cd-link">{cat.customer.name ?? cat.customer.phone}</Link>
            <span className="text-xs cd-muted">›</span>
            <span className="text-xs cd-muted">{cat.name}</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            {cat.name}
            {cat.foundingNumber != null && (
              <span className="cd-pill" style={{ background: 'rgba(231,206,122,0.45)', color: '#8a6c00', border: '1px solid rgba(184,144,43,0.4)' }}>
                ★ Founding Cat #{String(cat.foundingNumber).padStart(3, '0')}
              </span>
            )}
          </h1>
          <p className="text-sm cd-muted">
            Owner: <Link href={`/customers/${cat.customerId}`} className="cd-link font-medium">{cat.customer.name ?? cat.customer.phone}</Link>
            {cat.customer.phone && (
              <> · <a href={whatsappUrl(cat.customer.phone)} target="_blank" rel="noopener noreferrer" className="cd-link">
                {displayPhone(cat.customer.phone)}
              </a></>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/cats/${id}/assess`} className="text-sm px-3 py-2 rounded-lg font-medium"
            style={{ background: SEGMENTS.grooming.bg, color: SEGMENTS.grooming.text, border: `1px solid ${SEGMENTS.grooming.color}44` }}>
            + Assessment
          </Link>
          <Link href={`/appointments/new?catId=${cat.id}&customerId=${cat.customerId}`} className="cd-btn text-sm">
            + Book Appointment
          </Link>
          <Link href={`/cats/${id}/edit`} className="cd-btn-sec text-sm">Edit</Link>
        </div>
      </div>

      {/* Owner membership banner */}
      {activeMembership && (
        <div className="rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)' }}>
          <div className="text-sm" style={{ color: '#2D1907' }}>
            <span className="font-semibold">{cat.customer.name ?? cat.customer.phone}</span> holds a{' '}
            <span className="font-semibold">{activeMembership.tier.name}</span> membership
            {activeMembership.tier.groomingCredits > 0 && ` (${activeMembership.tier.groomingCredits} grooming/mo)`}
          </div>
          <Link href={`/customers/${cat.customerId}`} className="text-xs cd-link">View customer →</Link>
        </div>
      )}

      {/* Cat info grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <InfoCard label="Breed" value={cat.breed ?? '—'} />
        <InfoCard label="Coat" value={cat.coatType ? `${cat.coatType} hair` : '—'} />
        <InfoCard label="Gender" value={cat.gender ?? '—'} />
        <InfoCard label="Life Stage" value={cat.lifeStage ?? '—'} />
        <InfoCard label="DOB" value={cat.dateOfBirth?.toLocaleDateString('en-MY') ?? '—'} />
      </div>

      {/* Photos & videos */}
      <div className="cd-card p-4">
        <MediaSection ownerType="cat" ownerId={cat.id} accept="both" label="photo" title="Photos & videos" />
      </div>

      {/* Grooming before & after — latest visit, read-only (capture happens on the assessment screen) */}
      {latestGroomAppt && groomMedia.length > 0 && (
        <div className="cd-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2" style={{ color: '#2D1907' }}>
              <span className="rounded-full" style={{ width: 7, height: 7, background: SEGMENTS.grooming.color }} />
              Grooming before &amp; after
            </h2>
            <span className="text-xs cd-muted">
              {latestGroomAppt.type} · {latestGroomAppt.scheduledAt.toLocaleDateString('en-MY')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MediaSection ownerType="appointment" ownerId={latestGroomAppt.id} tag={GROOM_MEDIA_TAGS.before} accept="both" label="before shot" title="Before" readOnly />
            <MediaSection ownerType="appointment" ownerId={latestGroomAppt.id} tag={GROOM_MEDIA_TAGS.after} accept="both" label="after shot" title="After" readOnly />
          </div>
        </div>
      )}

      {/* Grooming status */}
      <div className="rounded-xl p-4" style={groomingStyle}>
        <div className="text-sm font-semibold">
          {overdue
            ? `Grooming overdue by ${Math.abs(daysUntil)} days`
            : daysUntil === 0
            ? 'Grooming due today!'
            : `Next grooming in ${daysUntil} days`}
        </div>
        <div className="text-xs mt-0.5 opacity-75">
          Last groomed: {lastGroomed ? lastGroomed.toLocaleDateString('en-MY') : 'Never'} ·
          Interval: {cat.groomingInterval ? `${cat.groomingInterval}d (custom)` : 'breed default'}
        </div>
      </div>

      {/* Health & Care (boarding SOP: vaccination + parasite control + feeding) */}
      <div className="cd-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Health &amp; Care</h2>
          {gate.blockers.length > 0 ? (
            <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
              Not boarding-ready · {gate.blockers.join(', ')} needed
            </span>
          ) : gate.treatmentsNeeded.length > 0 ? (
            <span className="cd-pill" style={{ background: 'rgba(184,144,43,0.16)', color: '#8a6c00', border: '1px solid rgba(184,144,43,0.4)' }}>
              Boarding: {gate.treatmentsNeeded.join(' + ')} treatment (RM {gate.autoChargeRM} on check-in)
            </span>
          ) : (
            <span className="cd-pill" style={{ background: 'rgba(95,122,63,0.16)', color: '#4d6330', border: '1px solid rgba(95,122,63,0.4)' }}>
              ✓ Boarding-ready
            </span>
          )}
        </div>

        {/* Vaccination — explicit expiry date */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
          <div className="flex items-center gap-2">
            <StatusChip status={gate.vaccination} />
            <div>
              <div className="text-sm font-medium" style={{ color: '#2D1907' }}>Vaccination <span className="cd-muted font-normal">· annual</span></div>
              <div className="text-xs cd-muted">{cat.vaccinationExpiry ? `Expires ${cat.vaccinationExpiry.toLocaleDateString('en-MY')}` : 'Not recorded'}</div>
            </div>
          </div>
          <form action={setVaccination} className="flex items-center gap-2">
            <input name="vaccinationExpiry" type="date"
              defaultValue={cat.vaccinationExpiry ? cat.vaccinationExpiry.toISOString().split('T')[0] : ''}
              className="cd-input" style={{ width: 'auto' }} />
            <SubmitButton className="cd-btn-sec text-sm" busyLabel="Working…">Save</SubmitButton>
          </form>
        </div>

        {/* Deworm — last done + monthly interval */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
          <div className="flex items-center gap-2">
            <StatusChip status={gate.deworm} />
            <div>
              <div className="text-sm font-medium" style={{ color: '#2D1907' }}>Deworming <span className="cd-muted font-normal">· monthly</span></div>
              <div className="text-xs cd-muted">{cat.lastDewormAt ? `Last ${cat.lastDewormAt.toLocaleDateString('en-MY')}` : 'Not recorded'}</div>
            </div>
          </div>
          <form action={markDeworm}><SubmitButton className="cd-btn-sec text-sm" busyLabel="Working…">Mark done today</SubmitButton></form>
        </div>

        {/* Deflea — last done + monthly interval */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
          <div className="flex items-center gap-2">
            <StatusChip status={gate.deflea} />
            <div>
              <div className="text-sm font-medium" style={{ color: '#2D1907' }}>Flea treatment <span className="cd-muted font-normal">· monthly</span></div>
              <div className="text-xs cd-muted">{cat.lastDefleaAt ? `Last ${cat.lastDefleaAt.toLocaleDateString('en-MY')}` : 'Not recorded'}</div>
            </div>
          </div>
          <form action={markDeflea}><SubmitButton className="cd-btn-sec text-sm" busyLabel="Working…">Mark done today</SubmitButton></form>
        </div>

        {/* Feeding profile (edited on the Edit page) */}
        <div className="py-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
          <div className="text-sm font-medium mb-1" style={{ color: '#2D1907' }}>Feeding</div>
          <div className="text-xs cd-muted">
            {cat.dietType ?? 'Diet not set'} · {meals} meal{meals === 1 ? '' : 's'}/day{cat.mealsPerDay ? '' : ' (by life stage)'}
            {cat.portion ? ` · ${cat.portion}/meal` : ''}
            {cat.medication ? ` · 💊 ${cat.medication}` : ''}
          </div>
          {cat.feedingNotes && <div className="text-xs cd-muted mt-0.5">Note: {cat.feedingNotes}</div>}
        </div>
      </div>

      {/* Founding Cat number */}
      <div className="cd-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: '#2D1907' }}>Founding Cat number</div>
          <div className="text-xs cd-muted">
            {cat.foundingNumber != null
              ? `Permanent number CAT-${String(cat.foundingNumber).padStart(3, '0')} — priority booking, honour wall, double lucky-draw entries`
              : nextFounding
              ? `${takenNumbers.length}/${FOUNDER_CIRCLE_LIMIT} taken · next free: CAT-${String(nextFounding).padStart(3, '0')}`
              : `All ${FOUNDER_CIRCLE_LIMIT} Founding Cat numbers are taken`}
          </div>
        </div>
        <form action={setFoundingNumber} className="flex items-center gap-2">
          <input name="foundingNumber" type="number" min="1" max={FOUNDER_CIRCLE_LIMIT}
            defaultValue={cat.foundingNumber ?? nextFounding ?? ''}
            className="cd-input" style={{ width: '6rem' }} />
          <SubmitButton className="cd-btn-sec text-sm" busyLabel="Working…">Save</SubmitButton>
        </form>
      </div>

      {cat.healthNotes && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)', color: '#2D1907' }}>
          <strong>Health Notes:</strong> {cat.healthNotes}
        </div>
      )}

      {/* Care & assessment history (建档) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 7, height: 7, background: SEGMENTS.grooming.color }} />
            Care Profile
            <span className="font-normal text-sm cd-muted">({cat.assessments.length} assessment{cat.assessments.length === 1 ? '' : 's'})</span>
          </h2>
          <Link href={`/cats/${id}/assess`} className="text-xs cd-link">+ New assessment</Link>
        </div>
        {cat.assessments.length === 0 ? (
          <div className="cd-card px-4 py-5 text-sm cd-muted">
            No assessment yet. After the first hands-on check, record skin, coat, ears, nails and stress here —
            it becomes the cat&apos;s growth record and sets the rebooking cycle.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Latest in full */}
            {(() => {
              const a = cat.assessments[0]
              const pills: [string, string | null][] = [
                ['Skin', a.skinCondition], ['Coat', a.coatCondition], ['Ears', a.earCondition],
                ['Nails', a.nailCondition], ['Stress', a.stressLevel],
                ['Weight', a.weightKg ? `${a.weightKg} kg` : null],
              ]
              return (
                <div className="cd-card p-4 space-y-2" style={{ borderLeft: `3px solid ${SEGMENTS.grooming.color}` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: SEGMENTS.grooming.text }}>
                      Latest — {a.createdAt.toLocaleDateString('en-MY')}
                    </span>
                    {a.rebookDays && <span className="text-xs cd-muted">Rebook every {a.rebookDays}d</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pills.filter(([, v]) => v).map(([k, v]) => (
                      <span key={k} className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: '#2D1907' }}>
                        {k}: <strong>{v}</strong>
                      </span>
                    ))}
                  </div>
                  {a.findings && <p className="text-sm" style={{ color: '#2D1907' }}><span className="cd-muted">Findings:</span> {a.findings}</p>}
                  {a.carePlan && <p className="text-sm" style={{ color: '#2D1907' }}><span className="cd-muted">Care plan:</span> {a.carePlan}</p>}
                </div>
              )
            })()}
            {/* Older ones as a compact table */}
            {cat.assessments.length > 1 && (
              <div className="cd-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="cd-thead">
                      <th>Date</th><th>Skin</th><th>Coat</th><th>Stress</th><th>Weight</th><th>Cycle</th>
                    </tr></thead>
                    <tbody className="cd-tbody">
                      {cat.assessments.slice(1).map(a => (
                        <tr key={a.id}>
                          <td className="px-4 py-2" style={{ color: '#2D1907' }}>{a.createdAt.toLocaleDateString('en-MY')}</td>
                          <td className="px-4 py-2 cd-muted">{a.skinCondition ?? '—'}</td>
                          <td className="px-4 py-2 cd-muted">{a.coatCondition ?? '—'}</td>
                          <td className="px-4 py-2 cd-muted">{a.stressLevel ?? '—'}</td>
                          <td className="px-4 py-2 cd-muted">{a.weightKg ? `${a.weightKg} kg` : '—'}</td>
                          <td className="px-4 py-2 cd-muted">{a.rebookDays ? `${a.rebookDays}d` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Appointment history */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Appointment History</h2>
        <div className="cd-card overflow-hidden">
          {cat.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No appointments yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="cd-thead">
                  <th>Date</th>
                  <th>Type</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Price</th>
                </tr></thead>
                <tbody className="cd-tbody">
                  {cat.appointments.map(a => (
                    <tr key={a.id}>
                      <td className="px-4 py-2" style={{ color: '#2D1907' }}>{a.scheduledAt.toLocaleDateString('en-MY')}</td>
                      <td className="px-4 py-2 cd-muted">{a.type}</td>
                      <td className="px-4 py-2 cd-muted">{a.room?.name ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className="cd-pill" style={apptStatusStyle(a.status)}>{a.status}</span>
                      </td>
                      <td className="px-4 py-2 cd-muted">{a.price != null ? `RM ${a.price.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-sm font-medium" style={{ color: '#2D1907' }}>{value}</div>
    </div>
  )
}

function StatusChip({ status }: { status: HealthStatus }) {
  const map = {
    ok:       { label: 'Current',  color: '#4d6330', bg: 'rgba(95,122,63,0.16)' },
    due:      { label: 'Due soon', color: '#8a6c00', bg: 'rgba(184,144,43,0.16)' },
    overdue:  { label: 'Overdue',  color: '#B14919', bg: 'rgba(177,73,25,0.12)' },
    missing:  { label: 'Not set',  color: 'rgba(45,25,7,0.5)', bg: 'rgba(45,25,7,0.06)' },
  }[status.state]
  return (
    <span className="cd-pill shrink-0 text-center" style={{ background: map.bg, color: map.color, minWidth: '4.7rem' }}>
      {map.label}
    </span>
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
