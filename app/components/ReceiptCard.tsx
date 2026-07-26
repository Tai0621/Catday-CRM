import { displayPhone } from '@/lib/phone'
import type { ReceiptView } from '@/lib/receipt'

// The branded receipt itself — shared by the staff receipt page and the public
// customer link. Pure presentation; no data access, no actions.
export function ReceiptCard({
  view, business,
}: {
  view: ReceiptView
  business: { name: string; tagline?: string; address?: string; phone?: string }
}) {
  return (
    <div className="cd-card p-6 space-y-4" style={{ background: '#FDFBF5' }}>
      <div className="text-center space-y-1">
        <div className="font-bold tracking-widest uppercase" style={{ fontFamily: 'var(--font-brand)', color: '#2D1907', letterSpacing: '0.18em' }}>
          {business.name}
        </div>
        {business.tagline && <div className="text-xs cd-muted uppercase">{business.tagline}</div>}
        {(business.address || business.phone) && (
          <div className="text-xs cd-muted">{[business.address, business.phone].filter(Boolean).join(' · ')}</div>
        )}
        <div className="text-xs cd-muted pt-1">
          {view.reference ?? view.id} · {view.date.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
        {view.customer && (
          <div className="text-xs cd-muted">{view.customer.name ?? displayPhone(view.customer.phone)}</div>
        )}
      </div>

      <div style={{ borderTop: '1px dashed rgba(45,25,7,0.25)' }} />

      <table className="w-full text-sm">
        <tbody>
          {view.lines.map(l => (
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
        <span className="text-xl font-bold" style={{ color: '#2D1907' }}>RM {view.grandTotal.toFixed(2)}</span>
      </div>
      <div className="space-y-0.5">
        {view.payments.map((p, i) => (
          <div key={i} className="flex justify-between text-xs cd-muted">
            <span>Paid by {p.method}</span><span>RM {p.amount.toFixed(2)}</span>
          </div>
        ))}
        {view.points && (
          <div className="flex justify-between text-xs" style={{ color: '#8a6c00' }}>
            <span>Points earned</span><span>+{view.points}</span>
          </div>
        )}
      </div>

      <p className="text-center text-xs cd-muted pt-2">Thank you — see you and your cat again soon 🐾</p>
    </div>
  )
}
