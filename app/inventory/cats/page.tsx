import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { stockList, saleGate, ageLabel, lifeStageFor, desexLabel, CAT_BREEDS } from '@/lib/cat-stock'
import { CAT_STOCK_ROLES, CAT_STOCK_STATUSES, CAT_STOCK_STATUS_LABELS, CAT_STOCK_ROLE_HINTS, CAT_COST_CATEGORIES, GENDERS } from '@/lib/constants'
import { addStockCat, addCostBatch } from './actions'
import { SubmitButton } from '@/app/components/Pending'

const rm = (n: number | null) => (n == null ? '—' : `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`)

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  InStock: { background: 'rgba(114,144,148,0.18)', color: '#2D1907' },
  Reserved: { background: 'rgba(231,206,122,0.4)', color: '#7a5c00' },
  Sold: { background: 'rgba(122,138,79,0.2)', color: '#4a5530' },
  Rehomed: { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' },
  Deceased: { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.45)' },
}

// The cat inventory. The animal's own record stays at /cats/[id] — this page
// answers what a cat is worth and whether it can be sold, which is a different
// question from how it is doing.
export default async function CatInventoryPage({ searchParams }: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; ready?: string; error?: string; batched?: string }>
}) {
  await requireManager()
  const { q, role, status, ready, error, batched } = await searchParams

  const where: Record<string, unknown> = {}
  if (role) where.role = role
  // Default to what is still here. Sold and rehomed cats stay in the table for
  // the record, but a list that opens on every animal the business ever held
  // gets longer every year and answers nothing.
  where.status = status ? status : { in: ['InStock', 'Reserved'] }
  if (q) {
    where.OR = [
      { sku: { contains: q } },
      { cat: { name: { contains: q } } },
      { cat: { breed: { contains: q } } },
    ]
  }

  const rows = await stockList(where)

  const now = new Date()
  const withGate = rows.map(s => ({ s, gate: saleGate(s, now) }))
  const shown = ready === '1' ? withGate.filter(r => r.gate.ready) : withGate

  const readyCount = withGate.filter(r => r.gate.ready).length
  const litters = await db.litter.findMany({ select: { id: true, code: true }, orderBy: { code: 'desc' }, take: 50 })

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>
            Cat Inventory <span className="font-normal text-base cd-muted">({rows.length})</span>
          </h1>
          <p className="text-sm cd-muted">{readyCount} ready to sell today</p>
        </div>
        <Link href="/inventory/litters" className="cd-btn-sec">Litters</Link>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.25)' }}>
          {error}
        </div>
      )}
      {batched && (
        <div className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(122,138,79,0.16)', color: '#4a5530', border: '1px solid rgba(122,138,79,0.3)' }}>
          Cost recorded against {batched} cat{batched === '1' ? '' : 's'}.
        </div>
      )}

      <form className="cd-card p-3 flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: '10rem' }}>
          <label className="cd-label">Search</label>
          <input name="q" defaultValue={q} placeholder="Name, breed, or SKU…" className="cd-input" />
        </div>
        <div>
          <label className="cd-label">Role</label>
          <select name="role" defaultValue={role ?? ''} className="cd-input" style={{ width: 'auto' }}>
            <option value="">All</option>
            {CAT_STOCK_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Status</label>
          <select name="status" defaultValue={status ?? ''} className="cd-input" style={{ width: 'auto' }}>
            <option value="">Here now</option>
            {CAT_STOCK_STATUSES.map(s => <option key={s} value={s}>{CAT_STOCK_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm pb-1.5">
          <input type="checkbox" name="ready" value="1" defaultChecked={ready === '1'} />
          Ready to sell
        </label>
        <SubmitButton className="cd-btn-sec" busyLabel="Working…">Filter</SubmitButton>
      </form>

      <div className="cd-card overflow-hidden">
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-sm cd-muted text-center">No cats match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead">
                <th>SKU</th><th>Cat</th><th>Age</th><th>Role</th><th>Status</th>
                <th>Asking</th><th>Ready</th>
              </tr></thead>
              <tbody className="cd-tbody">
                {shown.map(({ s, gate }) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link href={`/inventory/cats/${s.id}`} className="font-medium hover:underline" style={{ color: '#2D1907' }}>{s.sku}</Link>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>
                      {s.cat.name}
                      <span className="cd-muted text-xs block">
                        {[s.cat.breed, s.cat.gender, desexLabel(s.cat.gender, s.cat.desexedAt)].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 cd-muted whitespace-nowrap">
                      {ageLabel(s.cat.dateOfBirth, now)}
                      <span className="text-xs block">{lifeStageFor(s.cat.dateOfBirth, null, now) ?? ''}</span>
                    </td>
                    <td className="px-4 py-2.5 cd-muted">{s.role}</td>
                    <td className="px-4 py-2.5">
                      <span className="cd-pill" style={STATUS_STYLE[s.status]}>{CAT_STOCK_STATUS_LABELS[s.status] ?? s.status}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{rm(s.askingRM)}</td>
                    <td className="px-4 py-2.5">
                      {gate.ready
                        ? <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.2)', color: '#4a5530' }}>Ready</span>
                        : <span className="text-xs" style={{ color: '#B14919' }} title={gate.blockers.join('; ')}>{gate.blockers[0]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="cd-card p-4">
        <summary className="font-semibold cursor-pointer" style={{ color: '#2D1907' }}>Add a cat to inventory</summary>
        <form action={addStockCat} className="mt-3 grid md:grid-cols-3 gap-3">
          <div><label className="cd-label">Name</label><input name="name" required className="cd-input" /></div>
          <div>
            <label className="cd-label">Breed</label>
            <select name="breed" className="cd-input">
              <option value="">—</option>
              {CAT_BREEDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Sex</label>
            <select name="gender" className="cd-input">
              <option value="">—</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div><label className="cd-label">Date of birth</label><input name="dateOfBirth" type="date" className="cd-input" /></div>
          <div>
            <label className="cd-label">Role</label>
            <select name="role" defaultValue="ForSale" className="cd-input">
              {CAT_STOCK_ROLES.map(r => <option key={r} value={r}>{r} — {CAT_STOCK_ROLE_HINTS[r]}</option>)}
            </select>
          </div>
          <div><label className="cd-label">SKU (blank = auto)</label><input name="sku" className="cd-input" placeholder="CD-BSH-026" /></div>
          <div><label className="cd-label">Acquired on</label><input name="acquiredAt" type="date" className="cd-input" /></div>
          <div><label className="cd-label">Acquired from</label><input name="acquiredFrom" className="cd-input" placeholder="Cattery, or Own litter" /></div>
          <div><label className="cd-label">Acquisition cost (RM)</label><input name="acquisitionRM" type="number" min="0" step="1" defaultValue="0" className="cd-input" /></div>
          <div><label className="cd-label">Asking price (RM)</label><input name="askingRM" type="number" min="0" step="1" className="cd-input" /></div>
          <div><label className="cd-label">Microchip no.</label><input name="microchipNo" className="cd-input" /></div>
          <div><label className="cd-label">Registration no.</label><input name="registrationNo" className="cd-input" /></div>
          <div><label className="cd-label">Last vaccinated</label><input name="lastVaccinatedAt" type="date" className="cd-input" /></div>
          <div><label className="cd-label">Next vaccine due</label><input name="vaccinationExpiry" type="date" className="cd-input" /></div>
          <div><label className="cd-label">Desexed on</label><input name="desexedAt" type="date" className="cd-input" /></div>
          <div className="md:col-span-3"><label className="cd-label">Notes</label><input name="notes" className="cd-input" /></div>
          <div className="md:col-span-3"><SubmitButton className="cd-btn" busyLabel="Working…">Add to inventory</SubmitButton></div>
        </form>
      </details>

      {/* One vet visit, many cats — the owner's Costing sheet as a form. */}
      <details className="cd-card p-4">
        <summary className="font-semibold cursor-pointer" style={{ color: '#2D1907' }}>
          Record one vet visit across several cats
        </summary>
        <p className="text-xs cd-muted mt-2">
          <strong>Per cat</strong> multiplies the rate by however many you tick — 57 cats at RM45 is RM2,565.
          <strong> Split evenly</strong> divides one invoice between them. Recording a vaccination also moves each
          cat&rsquo;s vaccination dates, so the boarding gate and the reminders stay right.
        </p>
        <form action={addCostBatch} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="cd-label">Date</label><input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="cd-input" style={{ width: 'auto' }} /></div>
            <div>
              <label className="cd-label">Category</label>
              <select name="category" defaultValue="Vaccination" className="cd-input" style={{ width: 'auto' }}>
                {CAT_COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="cd-label">Allocation</label>
              <select name="method" className="cd-input" style={{ width: 'auto' }}>
                <option value="PerCat">Per cat (rate × cats)</option>
                <option value="EvenSplit">Split one total evenly</option>
              </select>
            </div>
            <div><label className="cd-label">Amount (RM)</label><input name="amountRM" type="number" min="0" step="1" className="cd-input" style={{ width: '7rem' }} /></div>
            <div><label className="cd-label">Vet / vendor</label><input name="vendor" className="cd-input" style={{ width: '10rem' }} /></div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg p-2" style={{ border: '1px solid rgba(45,25,7,0.12)' }}>
            <div className="grid md:grid-cols-3 gap-1">
              {rows.map(s => (
                <label key={s.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="catStockIds" value={s.id} />
                  <span>{s.sku} {s.cat.name}</span>
                </label>
              ))}
            </div>
          </div>
          <SubmitButton className="cd-btn" busyLabel="Working…">Record against the ticked cats</SubmitButton>
        </form>
      </details>

      {litters.length > 0 && (
        <p className="text-xs cd-muted">
          {litters.length} litter{litters.length === 1 ? '' : 's'} recorded ·{' '}
          <Link href="/inventory/litters" className="cd-link">manage litters</Link>
        </p>
      )}
    </div>
  )
}
