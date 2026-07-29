import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { recordStockMovement, isLow, STOCK_REASON_LABELS } from '@/lib/inventory'
import { recordAudit } from '@/lib/audit'
import { SEGMENTS } from '@/lib/segments'

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const intOr = (v: FormDataEntryValue | null, d = 0) => { const n = parseInt((v as string) || '', 10); return Number.isFinite(n) ? n : d }

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireManager()
  const { id } = await params
  const product = await db.product.findUnique({ where: { id } })
  if (!product) notFound()
  const movements = await db.stockMovement.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 100 })

  async function stockAction(data: FormData) {
    'use server'
    const mode = data.get('mode') as string
    const qty = Math.max(0, intOr(data.get('qty')))
    const note = ((data.get('note') as string) ?? '').trim() || null
    const p = await db.product.findUnique({ where: { id }, select: { name: true, stockQty: true } })
    if (!p) return
    let delta = 0
    let reason: 'Restock' | 'Wastage' | 'Adjustment' = 'Restock'
    if (mode === 'receive') { delta = qty; reason = 'Restock' }
    else if (mode === 'wastage') { delta = -qty; reason = 'Wastage' }
    else if (mode === 'correction') { delta = qty - p.stockQty; reason = 'Adjustment' }
    if (delta === 0) return
    await recordStockMovement(id, delta, reason, { note })
    await recordAudit({ action: 'stock.move', entityType: 'Product', entityId: id, summary: `${p.name}: ${reason} ${delta > 0 ? '+' : ''}${delta}${note ? ` (${note})` : ''}` })
    revalidatePath(`/products/${id}`)
  }

  const low = isLow(product.stockQty, product.reorderLevel)
  const seg = SEGMENTS.business

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Link href="/products" className="text-xs cd-muted hover:underline">Products</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">{product.name}</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          {product.name}
        </h1>
        {product.sku && <p className="text-sm cd-muted">SKU {product.sku}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="In stock" value={String(product.stockQty)} accent={low} />
        <Stat label="Reorder at" value={product.reorderLevel != null ? String(product.reorderLevel) : '—'} />
        <Stat label="Sell price" value={rm(product.price)} />
        <Stat label="Stock at cost" value={rm(product.stockQty * product.costPrice)} />
      </div>

      {low && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
          Low stock — {product.stockQty} left (reorder at {product.reorderLevel}). Time to reorder.
        </div>
      )}

      {/* Stock action */}
      <form action={stockAction} className="cd-card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="cd-label">Action</label>
          <select name="mode" className="cd-input" style={{ width: '9rem' }} defaultValue="receive">
            <option value="receive">Receive (+)</option>
            <option value="wastage">Wastage / damage (−)</option>
            <option value="correction">Set count to</option>
          </select>
        </div>
        <div><label className="cd-label">Qty</label><input name="qty" type="number" min="0" defaultValue={0} className="cd-input" style={{ width: '5rem' }} /></div>
        <div className="flex-1" style={{ minWidth: '8rem' }}><label className="cd-label">Note</label><input name="note" className="cd-input" placeholder="e.g. supplier delivery" /></div>
        <button type="submit" className="cd-btn">Apply</button>
      </form>

      {/* Movement history */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Movement history</h2>
        <div className="cd-card overflow-hidden">
          {movements.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No stock movements yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="cd-thead"><th>When</th><th>Change</th><th>Reason</th><th>Ref / note</th></tr></thead>
              <tbody className="cd-tbody">
                {movements.map(m => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 cd-muted whitespace-nowrap">{m.createdAt.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })} {m.createdAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-2 font-semibold" style={{ color: m.delta >= 0 ? '#4d6330' : '#B14919' }}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    <td className="px-4 py-2" style={{ color: '#2D1907' }}>{STOCK_REASON_LABELS[m.reason] ?? m.reason}</td>
                    <td className="px-4 py-2 cd-muted">{m.reference ?? m.note ?? '—'}</td>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold" style={{ color: accent ? '#B14919' : '#2D1907' }}>{value}</div>
    </div>
  )
}
