import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { SEGMENTS } from '@/lib/segments'

// Retail catalog — what the POS sells besides services. Stock counts here are
// the seed of the Inventory round (low-stock will feed the Action Inbox).
export default async function ProductsPage() {
  await requireManager()
  const products = await db.product.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] })

  async function addProduct(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    if (!name) return
    await db.product.create({
      data: {
        name,
        price: parseFloat((data.get('price') as string) || '0'),
        costPrice: parseFloat((data.get('costPrice') as string) || '0'),
        stockQty: parseInt((data.get('stockQty') as string) || '0', 10),
        sku: ((data.get('sku') as string) ?? '').trim() || null,
        sortOrder: products.length + 1,
      },
    }).catch(() => {}) // duplicate name
    revalidatePath('/products')
  }

  async function updateProduct(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const restock = parseInt((data.get('restock') as string) || '0', 10)
    await db.product.update({
      where: { id },
      data: {
        price: parseFloat((data.get('price') as string) || '0'),
        costPrice: parseFloat((data.get('costPrice') as string) || '0'),
        ...(restock ? { stockQty: { increment: restock } } : {}),
      },
    })
    revalidatePath('/products')
  }

  async function toggleProduct(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const p = await db.product.findUnique({ where: { id } })
    if (p) await db.product.update({ where: { id }, data: { active: !p.active } })
    revalidatePath('/products')
  }

  const seg = SEGMENTS.business

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Products
        </h1>
        <p className="text-sm cd-muted">Retail catalog for the POS. Selling decrements stock automatically; restock here when deliveries arrive.</p>
      </div>

      <form action={addProduct} className="cd-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1" style={{ minWidth: '12rem' }}>
          <label className="cd-label">Product name</label>
          <input name="name" required className="cd-input" placeholder="e.g. OKANA Gift Box" />
        </div>
        <div>
          <label className="cd-label">Price (RM)</label>
          <input name="price" type="number" min="0" step="0.5" defaultValue="50" className="cd-input" style={{ width: '6.5rem' }} />
        </div>
        <div>
          <label className="cd-label">Cost (RM)</label>
          <input name="costPrice" type="number" min="0" step="0.5" defaultValue="0" className="cd-input" style={{ width: '6rem' }} />
        </div>
        <div>
          <label className="cd-label">Stock</label>
          <input name="stockQty" type="number" min="0" defaultValue="10" className="cd-input" style={{ width: '5.5rem' }} />
        </div>
        <div>
          <label className="cd-label">SKU (optional)</label>
          <input name="sku" className="cd-input" style={{ width: '7rem' }} />
        </div>
        <button type="submit" className="cd-btn">Add</button>
      </form>

      <div className="cd-card overflow-hidden">
        {products.length === 0 ? (
          <p className="px-4 py-8 text-sm cd-muted text-center">
            No products yet. Add your retail range — OKANA boxes, shampoo, treats — and they appear as buttons on the POS.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Product</th><th>Stock</th><th>Price / restock</th><th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {products.map(p => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.45 }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>
                    {p.name}
                    {p.sku && <span className="cd-muted font-normal text-xs"> · {p.sku}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="cd-pill" style={p.stockQty <= 3
                      ? { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
                      : { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
                      {p.stockQty} in stock
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <form action={updateProduct} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={p.id} />
                      <span className="cd-muted text-xs">RM</span>
                      <input name="price" type="number" min="0" step="0.5" defaultValue={p.price} className="cd-input" style={{ width: '5rem' }} title="Sell price" />
                      <span className="cd-muted text-xs">cost</span>
                      <input name="costPrice" type="number" min="0" step="0.5" defaultValue={p.costPrice} className="cd-input" style={{ width: '5rem' }} title="Unit cost" />
                      <span className="cd-muted text-xs">+stock</span>
                      <input name="restock" type="number" min="0" defaultValue={0} className="cd-input" style={{ width: '4.5rem' }} />
                      <button type="submit" className="cd-btn-sec text-xs">Save</button>
                    </form>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={toggleProduct}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-xs cd-link">{p.active ? 'Retire' : 'Restore'}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
