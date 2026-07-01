import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'
import { displayPhone, whatsappUrl } from '@/lib/phone'

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
    },
  })
  if (!cat) notFound()

  async function setVaccination(data: FormData) {
    'use server'
    const v = data.get('vaccinationExpiry') as string
    await db.cat.update({ where: { id }, data: { vaccinationExpiry: v ? new Date(v) : null } })
    redirect(`/cats/${id}`)
  }

  const lastGroomed = cat.appointments.find(a => a.type === 'Grooming' && a.status === 'Completed')?.scheduledAt ?? null
  const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval)
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
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{cat.name}</h1>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard label="Breed" value={cat.breed ?? '—'} />
        <InfoCard label="Gender" value={cat.gender ?? '—'} />
        <InfoCard label="Life Stage" value={cat.lifeStage ?? '—'} />
        <InfoCard label="DOB" value={cat.dateOfBirth?.toLocaleDateString('en-MY') ?? '—'} />
      </div>

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

      {/* Vaccination */}
      <div className="cd-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: '#2D1907' }}>Vaccination</div>
          <div className="text-xs cd-muted">
            {cat.vaccinationExpiry ? `Expires ${cat.vaccinationExpiry.toLocaleDateString('en-MY')}` : 'No expiry recorded'}
          </div>
        </div>
        <form action={setVaccination} className="flex items-center gap-2">
          <input name="vaccinationExpiry" type="date"
            defaultValue={cat.vaccinationExpiry ? cat.vaccinationExpiry.toISOString().split('T')[0] : ''}
            className="cd-input" style={{ width: 'auto' }} />
          <button type="submit" className="cd-btn-sec text-sm">Save</button>
        </form>
      </div>

      {cat.healthNotes && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)', color: '#2D1907' }}>
          <strong>Health Notes:</strong> {cat.healthNotes}
        </div>
      )}

      {/* Appointment history */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Appointment History</h2>
        <div className="cd-card overflow-hidden">
          {cat.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No appointments yet</p>
          ) : (
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
