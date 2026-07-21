import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { getConfig } from '@/lib/config'
import { PrintButton } from './PrintButton'

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params
  const config = await getConfig()

  const txn = await db.transaction.findUnique({
    where: { id },
    include: { customer: true, lines: true },
  })
  if (!txn) notFound()

  // Split payments share one reference (e.g. wallet portion + card portion)
  const siblings = txn.reference
    ? await db.transaction.findMany({ where: { reference: txn.reference, id: { not: txn.id } } })
    : []
  const grandTotal = txn.total + siblings.reduce((s, t) => s + t.total, 0)
  const payments = [txn, ...siblings].map(t => ({ method: t.method ?? '—', amount: t.total })).filter(p => p.amount > 0)

  const points = txn.customerId && txn.reference
    ? await db.loyaltyEntry.findFirst({ where: { customerId: txn.customerId, note: txn.reference } })
    : null

  const waText = [
    `Thank you for visiting ${config.business.name}! 🐾`,
    `Receipt ${txn.reference ?? txn.id}`,
    ...txn.lines.map(l => `· ${l.description}${l.quantity > 1 ? ` ×${l.quantity}` : ''} — RM ${l.subtotal.toFixed(2)}`),
    `Total: RM ${grandTotal.toFixed(2)}`,
    points ? `Points earned: ${points.points} 🌟` : '',
    `See you and your cat again soon!`,
  ].filter(Boolean).join('\n')

  return (
    <div className="max-w-sm mx-auto space-y-4">
      {/* Actions (hidden when printing) */}
      <div className="no-print flex items-center justify-between">
        <Link href="/pos" className="cd-btn-sec text-sm">← New sale</Link>
        <div className="flex gap-2">
          {txn.customer && (
            <a href={whatsappUrl(txn.customer.phone, waText)} target="_blank" rel="noopener noreferrer"
              className="text-sm px-3 py-2 rounded-lg" style={{ background: '#729094', color: '#F2EDE0' }}>
              WhatsApp receipt
            </a>
          )}
          <PrintButton />
        </div>
      </div>

      {/* The receipt */}
      <div className="cd-card p-6 space-y-4" style={{ background: '#FDFBF5' }}>
        <div className="text-center space-y-1">
          <div className="font-bold tracking-widest uppercase" style={{ fontFamily: 'var(--font-brand)', color: '#2D1907', letterSpacing: '0.18em' }}>
            {config.business.name}
          </div>
          <div className="text-xs cd-muted uppercase">{config.business.tagline}</div>
          {(config.business.address || config.business.phone) && (
            <div className="text-xs cd-muted">{[config.business.address, config.business.phone].filter(Boolean).join(' · ')}</div>
          )}
          <div className="text-xs cd-muted pt-1">
            {txn.reference ?? txn.id} · {txn.date.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
          {txn.customer && (
            <div className="text-xs cd-muted">{txn.customer.name ?? displayPhone(txn.customer.phone)}</div>
          )}
        </div>

        <div style={{ borderTop: '1px dashed rgba(45,25,7,0.25)' }} />

        <table className="w-full text-sm">
          <tbody>
            {txn.lines.map(l => (
              <tr key={l.id}>
                <td className="py-1 pr-2" style={{ color: '#2D1907' }}>
                  {l.description}{l.quantity > 1 && <span className="cd-muted"> ×{l.quantity}</span>}
                </td>
                <td className="py-1 text-right whitespace-nowrap" style={{ color: '#2D1907' }}>
                  RM {l.subtotal.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: '1px dashed rgba(45,25,7,0.25)' }} />

        <div className="flex items-baseline justify-between">
          <span className="font-semibold" style={{ color: '#2D1907' }}>Total</span>
          <span className="text-xl font-bold" style={{ color: '#2D1907' }}>RM {grandTotal.toFixed(2)}</span>
        </div>
        <div className="space-y-0.5">
          {payments.map((p, i) => (
            <div key={i} className="flex justify-between text-xs cd-muted">
              <span>Paid by {p.method}</span><span>RM {p.amount.toFixed(2)}</span>
            </div>
          ))}
          {points && (
            <div className="flex justify-between text-xs" style={{ color: '#8a6c00' }}>
              <span>Points earned</span><span>+{points.points}</span>
            </div>
          )}
        </div>

        <p className="text-center text-xs cd-muted pt-2">Thank you — see you and your cat again soon 🐾</p>
      </div>
    </div>
  )
}
