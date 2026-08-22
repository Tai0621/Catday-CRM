import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  ASSET_CATEGORIES, monthlyDepreciation, accumulatedDepreciation, netBookValue,
} from '@/lib/assets'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

// Fixed Asset Register (Administrative). Records feed the three statements:
// net book value → balance-sheet fixed assets, monthly charge → income-statement
// depreciation, purchases → cash-flow investing. Manager-only.

const rm = (v: number) => `RM ${Math.round(v).toLocaleString('en-MY')}`
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireManager()
  const { saved, error } = await searchParams
  const asOf = thisMonth()

  const assets = await db.fixedAsset.findMany({ orderBy: { purchaseDate: 'desc' } })

  async function add(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    const category = ((data.get('category') as string) ?? '').trim()
    const cost = Number(data.get('cost'))
    const salvageValue = Number(data.get('salvageValue') ?? 0) || 0
    const usefulLifeMonths = Math.round(Number(data.get('usefulLifeMonths')))
    const purchaseRaw = ((data.get('purchaseDate') as string) ?? '').trim()
    const notes = ((data.get('notes') as string) ?? '').trim() || null

    const fail = (msg: string) => redirect(`/admin/assets?error=${encodeURIComponent(msg)}`)
    if (!name) return fail('Name is required')
    if (!(ASSET_CATEGORIES as readonly string[]).includes(category)) return fail('Pick a category')
    if (!(cost > 0)) return fail('Cost must be greater than 0')
    if (salvageValue < 0 || salvageValue >= cost) return fail('Salvage must be 0 or more and less than cost')
    if (!(usefulLifeMonths >= 1)) return fail('Useful life must be at least 1 month')
    const purchaseDate = new Date(`${purchaseRaw}T00:00:00`)
    if (isNaN(purchaseDate.getTime())) return fail('Enter a valid purchase date')

    await db.fixedAsset.create({
      data: { name, category, cost, salvageValue, usefulLifeMonths, purchaseDate, notes },
    })
    revalidatePath('/', 'layout') // statements read the register
    redirect('/admin/assets?saved=1')
  }

  async function remove(data: FormData) {
    'use server'
    const id = (data.get('id') as string) ?? ''
    if (id) {
      await db.fixedAsset.delete({ where: { id } })
      revalidatePath('/', 'layout')
    }
    redirect('/admin/assets?saved=removed')
  }

  const totalCost = assets.reduce((s, a) => s + a.cost, 0)
  const totalAccum = assets.reduce((s, a) => s + accumulatedDepreciation(a, asOf), 0)
  const totalNBV = assets.reduce((s, a) => s + netBookValue(a, asOf), 0)
  const seg = SEGMENTS.business

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Fixed Asset Register
        </h1>
        <p className="text-sm cd-muted">
          Equipment, fit-out and other long-lived assets. Each depreciates straight-line over its useful life —
          net book value auto-fills the <span className="font-medium">balance sheet</span>, the monthly charge posts to the{' '}
          <span className="font-medium">income statement</span>, and purchases flow to <span className="font-medium">cash-flow investing</span>.
        </p>
      </div>

      {saved && (
        <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(122,138,79,0.15)', border: '1px solid rgba(122,138,79,0.35)', color: '#5c6b3c' }}>
          ✓ {saved === 'removed' ? 'Asset removed.' : 'Asset added.'}
        </div>
      )}
      {error && (
        <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.35)', color: '#B14919' }}>
          {error}
        </div>
      )}

      {/* Register totals */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Assets at cost', value: rm(totalCost) },
          { label: 'Accumulated depreciation', value: `(${rm(totalAccum)})` },
          { label: `Net book value · ${asOf}`, value: rm(totalNBV) },
        ].map(t => (
          <div key={t.label} className="cd-card p-4">
            <div className="text-[11px] uppercase tracking-wider cd-muted">{t.label}</div>
            <div className="text-lg font-bold" style={{ color: '#2D1907' }}>{t.value}</div>
          </div>
        ))}
      </div>

      {/* Asset table */}
      <div className="cd-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="cd-thead">
            <tr>
              <th className="text-left px-4 py-2.5">Asset</th>
              <th className="text-left px-4 py-2.5">Category</th>
              <th className="text-left px-4 py-2.5">Purchased</th>
              <th className="text-right px-4 py-2.5">Cost</th>
              <th className="text-right px-4 py-2.5">Life</th>
              <th className="text-right px-4 py-2.5">Monthly</th>
              <th className="text-right px-4 py-2.5">Accum.</th>
              <th className="text-right px-4 py-2.5">Net book value</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {assets.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center cd-muted">No assets yet. Add your first one below — statements stay unchanged until you do.</td></tr>
            )}
            {assets.map(a => {
              const nbv = netBookValue(a, asOf)
              const fullyDep = nbv <= a.salvageValue + 0.001
              return (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium" style={{ color: '#2D1907' }}>{a.name}</div>
                    {a.notes && <div className="text-xs cd-muted">{a.notes}</div>}
                  </td>
                  <td className="px-4 py-2.5 cd-muted">{a.category}</td>
                  <td className="px-4 py-2.5 cd-muted">{a.purchaseDate.toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{rm(a.cost)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap cd-muted">{a.usefulLifeMonths} mo</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{rm(monthlyDepreciation(a))}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap cd-muted">({rm(accumulatedDepreciation(a, asOf))})</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium" style={{ color: fullyDep ? '#729094' : '#2D1907' }}>
                    {rm(nbv)}{fullyDep && <span className="text-xs cd-muted"> · done</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={remove}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton className="text-xs cd-link" style={{ color: '#B14919' }} busyLabel="Working…">Remove</SubmitButton>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add asset */}
      <form action={add} className="cd-card p-5 space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: seg.text, letterSpacing: '0.08em' }}>Add an asset</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="cd-label">Asset name</label>
            <input name="name" className="cd-input" placeholder="e.g. Professional grooming table" required />
          </div>
          <div>
            <label className="cd-label">Category</label>
            <select name="category" className="cd-input" defaultValue="Equipment">
              {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Purchase date</label>
            <input name="purchaseDate" type="date" className="cd-input" defaultValue={isoDay(new Date())} required />
          </div>
          <div>
            <label className="cd-label">Cost (RM)</label>
            <input name="cost" type="number" step="any" min="0" className="cd-input" placeholder="0" required />
          </div>
          <div>
            <label className="cd-label">Salvage value (RM) <span className="cd-muted font-normal">· residual at end of life</span></label>
            <input name="salvageValue" type="number" step="any" min="0" className="cd-input" placeholder="0" defaultValue="0" />
          </div>
          <div>
            <label className="cd-label">Useful life (months)</label>
            <input name="usefulLifeMonths" type="number" step="1" min="1" className="cd-input" placeholder="e.g. 60" required />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="cd-label">Notes <span className="cd-muted font-normal">· optional</span></label>
            <input name="notes" className="cd-input" placeholder="serial no., supplier, location…" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="cd-btn" busyLabel="Working…">Add asset</SubmitButton>
          <span className="text-xs cd-muted">A common life: equipment 3–5 yrs (36–60 mo), fit-out 5–10 yrs, IT 3 yrs.</span>
        </div>
      </form>
    </div>
  )
}
