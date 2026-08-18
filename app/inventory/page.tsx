import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { isLow, houseUseCost } from '@/lib/inventory'
import { stockSummary } from '@/lib/cat-stock'

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`

// Two kinds of stock under one roof: things counted in units, and animals with
// names and vet records. The page exists so the owner can see one inventory
// value — which is also what the balance sheet reads.
export default async function InventoryPage() {
  await requireManager()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const products = await db.product.findMany({
    where: { active: true },
    select: { stockQty: true, costPrice: true, reorderLevel: true },
  })
  const cats = await stockSummary()
  const feed = await houseUseCost(monthStart, nextMonth)

  const units = products.reduce((s, p) => s + p.stockQty, 0)
  const productsAtCost = products.reduce((s, p) => s + p.stockQty * p.costPrice, 0)
  const lowCount = products.filter(p => isLow(p.stockQty, p.reorderLevel)).length

  // Cost per cat per month, herd-level. Deliberately not per-cat: sixty cats
  // share bowls, so a per-animal figure would be invented rather than measured —
  // and an invented number that looks precise gets used to price a cat.
  const perCat = cats.head > 0 ? feed / cats.head : 0

  const tiles = [
    { label: 'Product units', value: units.toLocaleString('en-MY') },
    { label: 'Products at cost', value: rm(productsAtCost) },
    { label: 'Cats on hand', value: String(cats.head) },
    { label: 'Cats at cost', value: rm(cats.atCost) },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Inventory</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl px-4 py-3 text-center"
            style={{ background: 'rgba(184,144,43,0.12)', border: '1px solid rgba(184,144,43,0.25)' }}>
            <div className="text-2xl font-bold" style={{ color: '#2D1907' }}>{t.value}</div>
            <div className="text-xs cd-muted">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="cd-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="cd-label">Total inventory value (at cost)</span>
          <span className="text-xl font-bold" style={{ color: '#2D1907' }}>{rm(productsAtCost + cats.atCost)}</span>
        </div>
        <p className="text-xs cd-muted mt-2">
          Cats are carried at what they cost to acquire. Vet, vaccination and feed are
          expensed in the month they are paid, so they are not added here — counting them
          twice would overstate profit.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="cd-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Products</h2>
            <Link href="/inventory/products" className="cd-link text-sm">Manage →</Link>
          </div>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between"><dt className="cd-muted">Units in stock</dt><dd>{units.toLocaleString('en-MY')}</dd></div>
            <div className="flex justify-between"><dt className="cd-muted">At cost</dt><dd>{rm(productsAtCost)}</dd></div>
            <div className="flex justify-between">
              <dt className="cd-muted">Low stock</dt>
              <dd style={{ color: lowCount > 0 ? '#B14919' : undefined }}>{lowCount}</dd>
            </div>
          </dl>
        </div>

        <div className="cd-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Cats</h2>
            <Link href="/inventory/cats" className="cd-link text-sm">Manage →</Link>
          </div>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between"><dt className="cd-muted">In stock</dt><dd>{cats.inStock}</dd></div>
            <div className="flex justify-between"><dt className="cd-muted">Reserved</dt><dd>{cats.reserved}</dd></div>
            <div className="flex justify-between"><dt className="cd-muted">Breeding stock</dt><dd>{cats.breeders}</dd></div>
            <div className="flex justify-between"><dt className="cd-muted">For sale / rehoming</dt><dd>{cats.forSale}</dd></div>
          </dl>
        </div>
      </div>

      <div className="cd-card p-4">
        <h2 className="font-semibold mb-2" style={{ color: '#2D1907' }}>Cattery running cost, this month</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <div className="text-xl font-bold" style={{ color: '#2D1907' }}>{rm(feed)}</div>
            <div className="text-xs cd-muted">Stock used by the cattery, at cost</div>
          </div>
          <div>
            <div className="text-xl font-bold" style={{ color: '#2D1907' }}>{rm(perCat)}</div>
            <div className="text-xs cd-muted">Per cat, per month</div>
          </div>
        </div>
        <p className="text-xs cd-muted mt-3">
          Recorded on the product ledger as <em>Used by the cattery</em> — the same movement a
          sale makes, without the sale. Record it from the product&rsquo;s own page.
        </p>
      </div>
    </div>
  )
}
