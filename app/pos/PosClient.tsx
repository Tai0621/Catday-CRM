'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkout, type CheckoutItem } from './actions'

interface CustomerOpt {
  id: string; name: string | null; phone: string
  walletBalance: number; pointsBalance: number
  tierName: string | null; multiplier: number
}
interface ApptOpt { id: string; customerId: string; catId: string; type: string; price: number; deposit: number; label: string }
interface ProductOpt { id: string; name: string; price: number; stockQty: number }
interface ServiceOpt { id: string; name: string; price: number; category: string }

const GROOMING = { color: '#B14919', bg: 'rgba(177,73,25,0.13)' }
const GOLD = { text: '#8a6c00', bg: 'rgba(231,206,122,0.35)', color: '#B8902B' }

export function PosClient({ preselectCustomerId, customers, appointments, products, services }: {
  preselectCustomerId: string | null
  customers: CustomerOpt[]
  appointments: ApptOpt[]
  products: ProductOpt[]
  services: ServiceOpt[]
}) {
  const router = useRouter()

  const apptItemsFor = (custId: string): CheckoutItem[] =>
    appointments.filter(a => a.customerId === custId).map(a => ({
      kind: 'appointment' as const,
      refId: a.id,
      catId: a.catId,
      label: a.deposit > 0 ? `${a.label} · deposit RM${a.deposit.toFixed(0)} credited` : a.label,
      qty: 1,
      unitPrice: Math.max(0, a.price - a.deposit),
    }))

  const [customerId, setCustomerId] = useState<string>(preselectCustomerId ?? '')
  const [items, setItems] = useState<CheckoutItem[]>(preselectCustomerId ? apptItemsFor(preselectCustomerId) : [])
  const [walletInput, setWalletInput] = useState<string>('0')
  const [method, setMethod] = useState<'Cash' | 'Card' | 'QR'>('Cash')
  const [customLabel, setCustomLabel] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customer = customers.find(c => c.id === customerId) ?? null
  const total = useMemo(() => Math.round(items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * 100) / 100, [items])
  const walletMax = customer ? Math.min(customer.walletBalance, total) : 0
  const walletAmount = Math.max(0, Math.min(parseFloat(walletInput) || 0, walletMax))
  const remainder = Math.round((total - walletAmount) * 100) / 100
  const pointsPreview = customer ? Math.floor(total * customer.multiplier) : 0

  function pickCustomer(id: string) {
    setCustomerId(id)
    setError(null)
    setWalletInput('0')
    // Reload the basket with this customer's unpaid visits; keep nothing stale
    setItems(id ? apptItemsFor(id) : [])
  }

  function addItem(item: CheckoutItem) {
    setItems(prev => {
      if (item.refId) {
        const i = prev.findIndex(x => x.kind === item.kind && x.refId === item.refId)
        if (i >= 0) {
          const next = [...prev]
          next[i] = { ...next[i], qty: next[i].qty + 1 }
          return next
        }
      }
      return [...prev, item]
    })
  }

  function bumpQty(idx: number, delta: number) {
    setItems(prev => prev
      .map((x, i) => (i === idx ? { ...x, qty: x.qty + delta } : x))
      .filter(x => x.qty > 0))
  }

  async function charge() {
    setBusy(true)
    setError(null)
    const res = await checkout(JSON.stringify({
      customerId: customerId || null,
      items,
      walletAmount,
      method,
    }))
    if (res.ok) {
      router.push(`/pos/receipt/${res.receiptId}`)
    } else {
      setError(res.error)
      setBusy(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: '#2D1907' }} />
          POS Checkout
        </h1>
        <p className="text-sm cd-muted">Pick the customer — their unpaid visits load automatically. Add retail, take payment, done.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Left: pick things ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="cd-card p-4 space-y-2">
            <label className="cd-label">Customer</label>
            <select value={customerId} onChange={e => pickCustomer(e.target.value)} className="cd-input">
              <option value="">Walk-in (no customer)</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
            </select>
            {customer && (
              <div className="flex flex-wrap gap-2 text-xs">
                {customer.tierName && (
                  <span className="cd-pill" style={{ background: GOLD.bg, color: GOLD.text }}>{customer.tierName} · {customer.multiplier}× points</span>
                )}
                <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
                  Wallet RM {customer.walletBalance.toFixed(2)}
                </span>
                <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
                  {customer.pointsBalance.toLocaleString()} pts
                </span>
              </div>
            )}
          </div>

          {products.length > 0 && (
            <div className="cd-card p-4">
              <div className="cd-label mb-2">Retail</div>
              <div className="flex flex-wrap gap-2">
                {products.map(p => (
                  <button key={p.id} disabled={busy}
                    onClick={() => addItem({ kind: 'product', refId: p.id, label: p.name, qty: 1, unitPrice: p.price })}
                    className="text-xs px-3 py-2 rounded-lg text-left"
                    style={{ background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }}>
                    <div className="font-semibold">{p.name}</div>
                    <div className="cd-muted">RM {p.price.toFixed(2)} · {p.stockQty} left</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cd-card p-4">
            <div className="cd-label mb-2">Services (ad-hoc, no booking)</div>
            <div className="flex flex-wrap gap-2">
              {services.map(s => (
                <button key={s.id} disabled={busy}
                  onClick={() => addItem({ kind: 'service', refId: s.id, label: s.name, qty: 1, unitPrice: s.price })}
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: GROOMING.bg, color: GROOMING.color, border: `1px solid ${GROOMING.color}33` }}>
                  {s.name} · RM {s.price.toFixed(0)}{s.category === 'Boarding' ? '/night' : ''}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Custom item" className="cd-input" style={{ flex: 2 }} />
              <input value={customPrice} onChange={e => setCustomPrice(e.target.value)} type="number" min="0" step="0.5" placeholder="RM" className="cd-input" style={{ flex: 1 }} />
              <button disabled={busy || !customLabel.trim() || !(parseFloat(customPrice) > 0)}
                onClick={() => {
                  addItem({ kind: 'custom', label: customLabel.trim(), qty: 1, unitPrice: parseFloat(customPrice) })
                  setCustomLabel(''); setCustomPrice('')
                }}
                className="cd-btn-sec text-xs whitespace-nowrap">+ Add</button>
            </div>
          </div>
        </div>

        {/* ── Right: basket & payment ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="cd-card overflow-hidden">
            <div className="cd-section-header" style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}>
              <span className="font-semibold text-sm" style={{ color: '#2D1907' }}>Basket</span>
              <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.6)' }}>{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-sm cd-muted text-center">Empty — pick a customer or tap items</p>
            ) : (
              <ul>
                {items.map((i, idx) => (
                  <li key={idx} className="px-4 py-2 flex items-center gap-2" style={{ borderTop: '1px solid rgba(45,25,7,0.06)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: '#2D1907' }}>{i.label}</div>
                      <div className="text-xs cd-muted">RM {i.unitPrice.toFixed(2)}{i.qty > 1 && ` × ${i.qty}`}</div>
                    </div>
                    {i.kind !== 'appointment' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => bumpQty(idx, -1)} className="cd-btn-sec text-xs" style={{ padding: '0.1rem 0.5rem' }}>−</button>
                        <button onClick={() => bumpQty(idx, 1)} className="cd-btn-sec text-xs" style={{ padding: '0.1rem 0.5rem' }}>+</button>
                      </div>
                    )}
                    {i.kind === 'appointment' && (
                      <button onClick={() => bumpQty(idx, -1)} className="text-xs cd-link">remove</button>
                    )}
                    <div className="text-sm font-semibold w-20 text-right" style={{ color: '#2D1907' }}>
                      RM {(i.qty * i.unitPrice).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="cd-card p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>Total</span>
              <span className="text-2xl font-bold" style={{ color: '#B14919' }}>RM {total.toFixed(2)}</span>
            </div>

            {customer && customer.walletBalance > 0 && total > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs cd-muted whitespace-nowrap">Pay from wallet:</span>
                <input type="number" min="0" max={walletMax} step="0.01" value={walletInput}
                  onChange={e => setWalletInput(e.target.value)} className="cd-input" style={{ width: '6.5rem' }} />
                <button onClick={() => setWalletInput(String(walletMax))} className="cd-btn-sec text-xs">Max</button>
              </div>
            )}

            {remainder > 0 && (
              <div>
                <div className="text-xs cd-muted mb-1.5">
                  {walletAmount > 0 ? `RM ${walletAmount.toFixed(2)} from wallet · remaining RM ${remainder.toFixed(2)} by:` : 'Payment method:'}
                </div>
                <div className="flex gap-2">
                  {(['Cash', 'Card', 'QR'] as const).map(m => (
                    <button key={m} onClick={() => setMethod(m)}
                      className="flex-1 text-sm py-2 rounded-lg font-medium"
                      style={method === m
                        ? { background: '#2D1907', color: '#ECDBB6' }
                        : { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customer && pointsPreview > 0 && (
              <p className="text-xs" style={{ color: GOLD.text }}>Earns {pointsPreview.toLocaleString()} points ({customer.multiplier}×)</p>
            )}

            {error && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919' }}>{error}</p>
            )}

            <button onClick={charge} disabled={busy || items.length === 0}
              className="cd-btn w-full text-base py-3"
              style={busy || items.length === 0 ? { opacity: 0.5 } : undefined}>
              {busy ? 'Charging…' : remainder > 0
                ? `Charge RM ${remainder.toFixed(2)} (${method})${walletAmount > 0 ? ' + wallet' : ''}`
                : total > 0 ? `Charge RM ${total.toFixed(2)} from wallet` : 'Charge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
