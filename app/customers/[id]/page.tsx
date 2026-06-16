import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { displayPhone, whatsappUrl } from '@/lib/phone'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      cats: { include: { appointments: { orderBy: { scheduledAt: 'desc' }, take: 3 } } },
      memberships: { include: { tier: true }, orderBy: { createdAt: 'desc' } },
      appointments: { include: { cat: true, room: true }, orderBy: { scheduledAt: 'desc' }, take: 10 },
      transactions: { orderBy: { date: 'desc' }, take: 10 },
    },
  })

  if (!customer) notFound()

  const activeMembership = customer.memberships.find(m => m.status === 'Active')

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{customer.name ?? 'Unnamed Customer'}</h1>
          <p className="text-sm text-gray-500">{displayPhone(customer.phone)}{customer.email && ` · ${customer.email}`}</p>
        </div>
        <div className="flex gap-2">
          <a href={whatsappUrl(customer.phone)} target="_blank" rel="noopener noreferrer"
            className="text-sm bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700">
            WhatsApp
          </a>
          <Link href={`/customers/${id}/edit`} className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200">
            Edit
          </Link>
          <Link href="/appointments/new" className="text-sm bg-rose-600 text-white px-3 py-2 rounded-lg hover:bg-rose-700">
            + Book
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard label="Source" value={customer.source} />
        <InfoCard label="Membership" value={activeMembership ? `${activeMembership.tier.name} · expires ${activeMembership.expiryDate.toLocaleDateString('en-MY')}` : 'None'} />
        <InfoCard label="Cats" value={String(customer.cats.length)} />
      </div>

      {customer.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <strong>Notes:</strong> {customer.notes}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Cats</h2>
          <Link href={`/cats/new?customerId=${id}`} className="text-xs text-rose-600 hover:underline">+ Add cat</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {customer.cats.map(cat => (
            <Link key={cat.id} href={`/cats/${cat.id}`}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-rose-200 transition-colors">
              <div className="font-medium text-gray-900">{cat.name}</div>
              <div className="text-xs text-gray-500">{cat.breed ?? 'Unknown breed'} · {cat.lifeStage ?? '—'}</div>
              {cat.appointments[0] && (
                <div className="text-xs text-gray-400 mt-1">
                  Last: {cat.appointments[0].scheduledAt.toLocaleDateString('en-MY')}
                </div>
              )}
            </Link>
          ))}
          {customer.cats.length === 0 && (
            <p className="text-sm text-gray-400">No cats on file</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-gray-900 mb-3">Recent Appointments</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {customer.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No appointments yet</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {customer.appointments.map(a => (
                  <tr key={a.id} className="px-4">
                    <td className="px-4 py-2 text-gray-600">{a.scheduledAt.toLocaleDateString('en-MY')}</td>
                    <td className="px-4 py-2 font-medium">{a.cat.name}</td>
                    <td className="px-4 py-2 text-gray-500">{a.type}{a.room && ` · ${a.room.name}`}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusClass(a.status)}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/appointments/${a.id}`} className="text-xs text-rose-600 hover:underline">View</Link>
                    </td>
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
