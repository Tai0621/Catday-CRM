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
    ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] }
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
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>
          Customers <span className="font-normal text-base cd-muted">({total})</span>
        </h1>
        <Link href="/customers/new" className="cd-btn">+ New Customer</Link>
      </div>

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name, phone, email…" className="cd-input flex-1" />
        <button type="submit" className="cd-btn-sec">Search</button>
      </form>

      <div className="cd-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="cd-thead">
            <th>Name</th>
            <th>Phone</th>
            <th>Cats</th>
            <th>Membership</th>
            <th>Source</th>
            <th></th>
          </tr></thead>
          <tbody className="cd-tbody">
            {customers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center cd-muted">No customers found</td></tr>
            )}
            {customers.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium" style={{ color: '#2D1907' }}>
                  {c.name ?? <span className="cd-muted italic">No name</span>}
                </td>
                <td className="px-4 py-3 cd-muted">{displayPhone(c.phone)}</td>
                <td className="px-4 py-3 cd-muted">{c.cats.length}</td>
                <td className="px-4 py-3">
                  {c.memberships[0] ? (
                    <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>
                      {c.memberships[0].tier.name}
                    </span>
                  ) : (
                    <span className="cd-muted text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 cd-muted text-xs">{c.source}</td>
                <td className="px-4 py-3">
                  <Link href={`/customers/${c.id}`} className="text-xs cd-link">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center text-sm">
          {page > 1 && <Link href={`?q=${q ?? ''}&page=${page - 1}`} className="px-3 py-1 rounded border cd-btn-sec">← Prev</Link>}
          <span className="px-3 py-1 cd-muted">{page} / {totalPages}</span>
          {page < totalPages && <Link href={`?q=${q ?? ''}&page=${page + 1}`} className="px-3 py-1 rounded cd-btn-sec">Next →</Link>}
        </div>
      )}
    </div>
  )
}
