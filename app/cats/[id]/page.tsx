import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'

export default async function CatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const cat = await db.cat.findUnique({
    where: { id },
    include: {
      customer: true,
      appointments: { orderBy: { scheduledAt: 'desc' }, include: { room: true } },
    },
  })
  if (!cat) notFound()

  const lastGroomed = cat.appointments.find(a => a.type === 'Grooming' && a.status === 'Completed')?.scheduledAt ?? null
  const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval)
  const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{cat.name}</h1>
          <p className="text-sm text-gray-500">
            Owner: <Link href={`/customers/${cat.customerId}`} className="text-rose-600 hover:underline">{cat.customer.name ?? cat.customer.phone}</Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/appointments/new?catId=${cat.id}&customerId=${cat.customerId}`}
            className="text-sm bg-rose-600 text-white px-3 py-2 rounded-lg hover:bg-rose-700">
            + Book Appointment
          </Link>
          <Link href={`/cats/${id}/edit`} className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard label="Breed" value={cat.breed ?? '—'} />
        <InfoCard label="Gender" value={cat.gender ?? '—'} />
        <InfoCard label="Life Stage" value={cat.lifeStage ?? '—'} />
        <InfoCard label="DOB" value={cat.dateOfBirth?.toLocaleDateString('en-MY') ?? '—'} />
      </div>

      <div className={`rounded-xl border p-4 ${daysUntil < 0 ? 'bg-red-50 border-red-200' : daysUntil <= 7 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <div className="text-sm font-semibold">
          {daysUntil < 0
            ? `Grooming overdue by ${Math.abs(daysUntil)} days`
            : daysUntil === 0
            ? 'Grooming due today!'
            : `Next grooming in ${daysUntil} days`}
        </div>
        <div className="text-xs mt-0.5 text-gray-600">
          Last groomed: {lastGroomed ? lastGroomed.toLocaleDateString('en-MY') : 'Never'} ·
          Interval: {cat.groomingInterval ? `${cat.groomingInterval}d (custom)` : 'breed default'}
        </div>
      </div>

      {cat.healthNotes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <strong>Health Notes:</strong> {cat.healthNotes}
        </div>
      )}

      <section>
        <h2 className="font-semibold text-gray-900 mb-3">Appointment History</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {cat.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No appointments yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Room</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cat.appointments.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{a.scheduledAt.toLocaleDateString('en-MY')}</td>
                    <td className="px-4 py-2">{a.type}</td>
                    <td className="px-4 py-2 text-gray-500">{a.room?.name ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusClass(a.status)}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{a.price != null ? `RM ${a.price.toFixed(2)}` : '—'}</td>
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
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
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
