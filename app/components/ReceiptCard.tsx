
import { displayPhone } from '@/lib/phone'
import type { ReceiptView } from '@/lib/receipt'

// The receipt as staff see it, on /pos/receipt/[id].
//
// It deliberately mirrors lib/receipt-pdf.ts line for line: same masthead, same
// order, same wording. The customer gets the PDF, so if this drifted, staff
// would be reading a different document from the one they just sent and would
// have no way to know.
//
// No em-dashes. Service names carry them in from the database
// ("Boarding — Standard (per night)"), so they are stripped at render rather
// than assumed away.
const noDash = (s: string) => s.replace(/\s*[—–]\s*/g, ' - ')

const HAIR = 'rgba(45,25,7,0.16)'
const MUTED = 'rgba(45,25,7,0.5)'

export function ReceiptCard({
  view, business, logoUrl,
}: {
  view: ReceiptView
  business: { name: string; tagline?: string; address?: string; phone?: string }
  /** The tenant's own mark (config brand.logoUrl), never a hardcoded file. */
  logoUrl: string
}) {
  // Shown as configured; displayPhone is for normalised customer mobiles and
  // would reformat the business landline into "+60 3-00000000".
  const contact = [business.address, business.phone].filter(Boolean).join('  ·  ')

  return (
    <div className="overflow-hidden" style={{
      background: '#FDFBF5',
      border: `1px solid ${HAIR}`,
      borderRadius: '0.75rem',
    }}>
      <div className="px-6 pt-6 pb-5 space-y-4">
        {/* ── Masthead ── */}
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo is a
              tenant setting that may be an SVG or a remote URL; next/image needs
              known dimensions and configured remote hosts, neither of which
              holds for a value the owner types into settings. */}
          <img
            src={logoUrl}
            alt={business.name}
            style={{ width: 148, height: 'auto', margin: '0 auto', display: 'block' }}
          />
          {business.tagline && (
            <div className="text-[10px] uppercase mt-2" style={{ color: MUTED, letterSpacing: '0.16em' }}>
              {business.tagline}
            </div>
          )}
          {contact && <div className="text-[11px] mt-1.5" style={{ color: MUTED }}>{contact}</div>}
        </div>

        <div style={{ borderTop: `1px dashed ${HAIR}` }} />

        {/* ── Who and when ── */}
        <div className="space-y-1.5">
          <Row label="Receipt" value={view.reference ?? view.id} bold />
          <Row label="Date" value={view.date.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })} />
          {view.customer && (
            <Row label="Customer" value={view.customer.name ?? displayPhone(view.customer.phone)} />
          )}
        </div>

        <div style={{ borderTop: `1px dashed ${HAIR}` }} />

        {/* ── Items ── */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left pb-1.5 text-[10px] font-bold uppercase" style={{ color: MUTED, letterSpacing: '0.1em' }}>Item</th>
                <th className="text-right pb-1.5 text-[10px] font-bold uppercase" style={{ color: MUTED, letterSpacing: '0.1em' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l, i) => (
                <tr key={l.id} style={i === 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}>
                  <td className="py-1.5 pr-3 text-sm" style={{ color: '#2D1907' }}>
                    {noDash(l.description)}
                    {l.quantity > 1 && <span style={{ color: MUTED }}> ×{l.quantity}</span>}
                  </td>
                  <td className="py-1.5 text-right text-sm whitespace-nowrap" style={{ color: '#2D1907' }}>
                    RM {l.subtotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: `1px dashed ${HAIR}` }} />

        {/* ── Total ── */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold uppercase" style={{ color: '#2D1907', letterSpacing: '0.08em' }}>Total</span>
          <span className="text-2xl font-bold" style={{ color: '#2D1907' }}>RM {view.grandTotal.toFixed(2)}</span>
        </div>

        <div className="space-y-1">
          {view.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-xs" style={{ color: MUTED }}>
              <span>Paid by {p.method}</span><span>RM {p.amount.toFixed(2)}</span>
            </div>
          ))}
          {view.points && (
            <div className="flex justify-between text-xs font-medium" style={{ color: '#8a6c00' }}>
              <span>Points earned</span><span>+{view.points}</span>
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px dashed ${HAIR}` }} />

        <div className="text-center space-y-1">
          <p className="text-xs" style={{ color: '#2D1907' }}>
            Thank you for visiting. See you and your cat again soon.
          </p>
          <p className="text-[10px]" style={{ color: MUTED }}>
            {business.name}  ·  this is a digital receipt
          </p>
        </div>
      </div>

      {/* The one brand accent, matching the rust rule along the foot of the PDF. */}
      <div style={{ height: 4, background: '#B14919' }} />
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase" style={{ color: MUTED, letterSpacing: '0.08em' }}>{label}</span>
      <span className={`text-sm text-right ${bold ? 'font-bold' : ''}`} style={{ color: '#2D1907' }}>{value}</span>
    </div>
  )
}
