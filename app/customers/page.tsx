import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { displayPhone } from '@/lib/phone'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAuth()
  const { q, page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? '1', 10))
  const perPage = 30
  const skip = (page - 1) * perPage

  const where = q
    ? {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      }
    : {}

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      include: {
        cats: { select: { id: true } },
        memberships: { where: { status: 'Active' }, include: { tier: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
    }),
    db.customer.count({ where }),
  ])

  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Customers <span className="text-gray-400 font-normal text-base">({total})</span></h1>
        <Link href="/customers/new" className="bg-rose-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-rose-700">+ New Customer</Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, phone, email…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
        />
        <button type="submit" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">Search</button>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Cats</th>
              <th className="px-4 py-3 text-left">Membership</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {customers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No customers found</td></tr>
            )}
            {customers.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.name ?? <span className="text-gray-400 italic">No name</span>}</td>
                <td className="px-4 py-3 text-gray-600">{displayPhone(c.phone)}</td>
                <td className="px-4 py-3 text-gray-600">{c.cats.length}</td>
                <td className="px-4 py-3">
                  {c.memberships[0] ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium">{c.memberships[0].tier.name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{c.source}</td>
                <td className="px-4 py-3">
                  <Link href={`/customers/${c.id}`} className="text-rose-600 hover:underline text-xs">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center text-sm">
          {page > 1 && <Link href={`?q=${q ?? ''}&page=${page - 1}`} className="px-3 py-1 rounded border hover:bg-gray-50">← Prev</Link>}
          <span className="px-3 py-1 text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && <Link href={`?q=${q ?? ''}&page=${page + 1}`} className="px-3 py-1 rounded border hover:bg-gray-50">Next →</Link>}
        </div>
      )}
    </div>
  )
}
