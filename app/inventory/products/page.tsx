import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { recordStockMovement, isLow } from '@/lib/inventory'
import { recordAudit } from '@/lib/audit'
import { SEGMENTS } from '@/lib/segments'

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`
const intOr = (v: FormDataEntryValue | null, d = 0) => { const n = parseInt((v as string) || '', 10); return Number.isFinite(n) ? n : d }

// Retail catalog + inventory. Selling decrements stock (logged in the
// StockMovement ledger); receive / adjust / write off stock here.
export default async function ProductsPage() {
  await requireManager()
  const products = await db.product.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] })

  const active = products.filter(p => p.active)
  const units = active.reduce((s, p) => s + p.stockQty, 0)
  const atCost = active.reduce((s, p) => s + p.stockQty * p.costPrice, 0)
  const lowCount = active.filter(p => isLow(p.stockQty, p.reorderLevel)).length

  async function addProduct(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    if (!name) return
    const stock = Math.max(0, intOr(data.get('stockQty')))
    try {
      const created = await db.product.create({
        data: {
          name,
          price: parseFloat((data.get('price') as string) || '0'),
          costPrice: parseFloat((data.get('costPrice') as string) || '0'),
          stockQty: 0,
          reorderLevel: (data.get('reorderLevel') as string)?.trim() ? Math.max(0, intOr(data.get('reorderLevel'))) : null,
          sku: ((data.get('sku') as string) ?? '').trim() || null,
          sortOrder: products.length + 1,
        },
      })
      if (stock > 0) await recordStockMovement(created.id, stock, 'InitialStock', { note: 'Opening stock' })
    } catch {
      // duplicate name — ignore
    }
    revalidatePath('/inventory/products')
  }

  async function updateProduct(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const reorderRaw = (data.get('reorderLevel') as string)?.trim()
    await db.product.update({
      where: { id },
      data: {
        price: parseFloat((data.get('price') as string) || '0'),
        costPrice: parseFloat((data.get('costPrice') as string) || '0'),
        reorderLevel: reorderRaw ? Math.max(0, intOr(data.get('reorderLevel'))) : null,
      },
    })
    revalidatePath('/inventory/products')
  }

  async function stockAction(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const mode = data.get('mode') as string
    const qty = Math.max(0, intOr(data.get('qty')))
    const note = ((data.get('note') as string) ?? '').trim() || null
    if (qty === 0 && mode !== 'correction') return
    const p = await db.product.findUnique({ where: { id }, select: { name: true, stockQty: true } })
    if (!p) return

    let delta = 0
    let reason: 'Restock' | 'Wastage' | 'Adjustment' | 'HouseUse' = 'Restock'
    if (mode === 'receive') { delta = qty; reason = 'Restock' }
    else if (mode === 'wastage') { delta = -qty; reason = 'Wastage' }
    // Stock the cattery ate rather than a customer bought. Same movement a sale
    // makes, minus the sale — so inventory at cost stays right and the cost of
    // keeping the shop's own cats is measured instead of estimated.
    else if (mode === 'house') { delta = -qty; reason = 'HouseUse' }
    else if (mode === 'correction') { delta = qty - p.stockQty; reason = 'Adjustment' }
    if (delta === 0) return

    await recordStockMovement(id, delta, reason, { note })
    await recordAudit({ action: 'stock.move', entityType: 'Product', entityId: id, summary: `${p.name}: ${reason} ${delta > 0 ? '+' : ''}${delta}${note ? ` (${note})` : ''}` })
    revalidatePath('/inventory/products')
  }

  async function toggleProduct(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const p = await db.product.findUnique({ where: { id } })
    if (p) await db.product.update({ where: { id }, data: { active: !p.active } })
    revalidatePath('/inventory/products')
  }

  const seg = SEGMENTS.business

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Products
        </h1>
        <p className="text-sm cd-muted">Selling decrements stock automatically. Receive deliveries, correct counts, write off damage, and record what the cattery consumed — every change is logged.</p>
      </div>

      {/* Valuation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active products" value={String(active.length)} />
        <Stat label="Units in stock" value={String(units)} />
        <Stat label="Stock at cost" value={rm(atCost)} />
        <Stat label="Low stock" value={String(lowCount)} accent={lowCount > 0} />
      </div>

      <form action={addProduct} className="cd-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1" style={{ minWidth: '11rem' }}>
          <label className="cd-label">Product name</label>
          <input name="name" required className="cd-input" placeholder="e.g. OKANA Gift Box" />
        </div>
        <div><label className="cd-label">Price</label><input name="price" type="number" min="0" step="0.5" defaultValue="50" className="cd-input" style={{ width: '5.5rem' }} /></div>
        <div><label className="cd-label">Cost</label><input name="costPrice" type="number" min="0" step="0.5" defaultValue="0" className="cd-input" style={{ width: '5rem' }} /></div>
        <div><label className="cd-label">Stock</label><input name="stockQty" type="number" min="0" defaultValue="10" className="cd-input" style={{ width: '5rem' }} /></div>
        <div><label className="cd-label">Reorder at</label><input name="reorderLevel" type="number" min="0" placeholder="—" className="cd-input" style={{ width: '5rem' }} /></div>
        <div><label className="cd-label">SKU</label><input name="sku" className="cd-input" style={{ width: '6rem' }} /></div>
        <button type="submit" className="cd-btn">Add</button>
      </form>

      <div className="cd-card overflow-hidden">
        {products.length === 0 ? (
          <p className="px-4 py-8 text-sm cd-muted text-center">No products yet. Add your retail range — they appear as buttons on the POS.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead"><th>Product</th><th>Stock</th><th>Price / cost / reorder</th><th>Stock movement</th><th></th></tr></thead>
              <tbody className="cd-tbody">
                {products.map(p => {
                  const low = isLow(p.stockQty, p.reorderLevel)
                  return (
                    <tr key={p.id} style={p.active ? undefined : { opacity: 0.45 }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>
                        <Link href={`/inventory/products/${p.id}`} className="hover:underline">{p.name}</Link>
                        {p.sku && <span className="cd-muted font-normal text-xs"> · {p.sku}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="cd-pill" style={low
                          ? { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
                          : { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
                          {p.stockQty}{p.reorderLevel != null ? ` / ${p.reorderLevel}` : ''}{low ? ' · low' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <form action={updateProduct} className="flex items-center gap-1.5">
                          <input type="hidden" name="id" value={p.id} />
                          <input name="price" type="number" min="0" step="0.5" defaultValue={p.price} className="cd-input" style={{ width: '4.5rem' }} title="Sell price" />
                          <input name="costPrice" type="number" min="0" step="0.5" defaultValue={p.costPrice} className="cd-input" style={{ width: '4.5rem' }} title="Unit cost" />
                          <input name="reorderLevel" type="number" min="0" defaultValue={p.reorderLevel ?? ''} placeholder="—" className="cd-input" style={{ width: '4rem' }} title="Reorder level" />
                          <button type="submit" className="cd-btn-sec text-xs">Save</button>
                        </form>
                      </td>
                      <td className="px-4 py-2.5">
                        <form action={stockAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="id" value={p.id} />
                          <select name="mode" className="cd-input text-xs" style={{ width: '6.5rem', padding: '0.25rem 0.4rem' }} defaultValue="receive">
                            <option value="receive">Receive +</option>
                            <option value="wastage">Wastage −</option>
                            <option value="house">Cattery −</option>
                            <option value="correction">Set to</option>
                          </select>
                          <input name="qty" type="number" min="0" defaultValue={0} className="cd-input" style={{ width: '3.75rem' }} />
                          <button type="submit" className="cd-btn-sec text-xs">Apply</button>
                        </form>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <form action={toggleProduct}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="text-xs cd-link">{p.active ? 'Retire' : 'Restore'}</button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold" style={{ color: accent ? '#B14919' : '#2D1907' }}>{value}</div>
    </div>
  )
}
