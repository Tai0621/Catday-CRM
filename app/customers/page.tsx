import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { displayPhone } from '@/lib/phone'
import { buildCustomerIntel, segmentStyle, SEGMENTS } from '@/lib/intelligence'
import { receivableByCustomer } from '@/lib/aging'
import { NOT_HOUSE } from '@/lib/cat-stock'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; segment?: string }> }) {
  await requireAuth()
  const { q, page: pageStr, segment } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? '1', 10))
  const perPage = 30

  // NOT_HOUSE is not optional here: the holding record that owns the shop's own
  // cats is not a customer, and left in it reads as one with sixty cats, no
  // spend, and a phone number nobody can call.
  const where = {
    ...NOT_HOUSE,
    ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } : {}),
  }

  const include = {
    cats: { select: { id: true } },
    memberships: { where: { status: 'Active' }, include: { tier: true } },
    appointments: { select: { scheduledAt: true, status: true } },
    transactions: { select: { total: true } },
  } as const

  // Segment filters are computed in JS, so fetch all matching rows when filtering;
  // otherwise paginate in the DB as before.
  const all = await db.customer.findMany({
    where,
    include,
    orderBy: { createdAt: 'desc' },
    ...(segment ? {} : { skip: (page - 1) * perPage, take: perPage }),
  })
  const total = await db.customer.count({ where })
  const owing = await receivableByCustomer()

  const withIntel = all.map(c => ({ c, intel: buildCustomerIntel(c) }))
  const rows = segment
    ? withIntel.filter(r => r.intel.segment === segment).slice((page - 1) * perPage, page * perPage)
    : withIntel

  const filteredTotal = segment ? withIntel.filter(r => r.intel.segment === segment).length : total
  const totalPages = Math.ceil(filteredTotal / perPage)

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>
          Customers <span className="font-normal text-base cd-muted">({filteredTotal})</span>
        </h1>
        <Link href="/customers/new" className="cd-btn">+ New Customer</Link>
      </div>

      <form className="flex gap-2">
        {segment && <input type="hidden" name="segment" value={segment} />}
        <input name="q" defaultValue={q} placeholder="Search by name, phone, email…" className="cd-input flex-1" />
        <button type="submit" className="cd-btn-sec">Search</button>
      </form>

      {/* Segment chips */}
      <div className="flex gap-2 flex-wrap text-sm">
        <Link href={q ? `?q=${q}` : '/customers'}
          className="px-3 py-1.5 rounded-lg transition-colors"
          style={!segment
            ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
            : { background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }}>
          All
        </Link>
        {SEGMENTS.map(s => (
          <Link key={s} href={`?segment=${s}${q ? `&q=${q}` : ''}`}
            className="px-3 py-1.5 rounded-lg transition-colors"
            style={segment === s
              ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
              : { background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }}>
            {s}
          </Link>
        ))}
      </div>

      <div className="cd-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Name</th>
              <th>Segment</th>
              <th>Phone</th>
              <th>Cats</th>
              <th>Lifetime (RM)</th>
              <th>Last Visit</th>
              <th>Membership</th>
              <th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center cd-muted">No customers found</td></tr>
              )}
              {rows.map(({ c, intel }) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium" style={{ color: '#2D1907' }}>
                    {c.name ?? <span className="cd-muted italic">No name</span>}
                    {owing.get(c.id) && (
                      <span className="ml-2 cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919', fontWeight: 600 }}>
                        owes RM {owing.get(c.id)!.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="cd-pill" style={segmentStyle(intel.segment)}>{intel.segment}</span>
                  </td>
                  <td className="px-4 py-3 cd-muted">{displayPhone(c.phone)}</td>
                  <td className="px-4 py-3 cd-muted">{c.cats.length}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: '#2D1907' }}>{intel.ltv > 0 ? intel.ltv.toFixed(0) : '—'}</td>
                  <td className="px-4 py-3 cd-muted">
                    {intel.daysSinceLastVisit === null ? 'Never' : intel.daysSinceLastVisit === 0 ? 'Today' : `${intel.daysSinceLastVisit}d ago`}
                  </td>
                  <td className="px-4 py-3">
                    {c.memberships[0] ? (
                      <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>
                        {c.memberships[0].tier.name}
                      </span>
                    ) : (
                      <span className="cd-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${c.id}`} className="text-xs cd-link">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center text-sm">
          {page > 1 && <Link href={`?q=${q ?? ''}&segment=${segment ?? ''}&page=${page - 1}`} className="px-3 py-1 rounded cd-btn-sec">← Prev</Link>}
          <span className="px-3 py-1 cd-muted">{page} / {totalPages}</span>
          {page < totalPages && <Link href={`?q=${q ?? ''}&segment=${segment ?? ''}&page=${page + 1}`} className="px-3 py-1 rounded cd-btn-sec">Next →</Link>}
        </div>
      )}
    </div>
  )
}
