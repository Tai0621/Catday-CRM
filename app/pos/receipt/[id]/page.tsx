import { requireAuth } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getConfig } from '@/lib/config'
import { getReceiptById, receiptWhatsappText } from '@/lib/receipt'
import { absoluteUrl } from '@/lib/base-url'
import { ReceiptCard } from '@/app/components/ReceiptCard'
import { PrintButton } from './PrintButton'
import { SendReceiptButton } from './SendReceiptButton'

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params
  const [config, view] = await Promise.all([getConfig(), getReceiptById(id)])
  if (!view) notFound()

  const publicUrl = await absoluteUrl(`/r/${view.token}`)
  const canWhatsapp = !!view.customer?.phone
  const waText = receiptWhatsappText(view, config.business.name, publicUrl)
  const waUrl = view.customer?.phone
    ? `https://wa.me/${view.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(waText)}`
    : ''

  return (
    <div className="max-w-sm mx-auto space-y-4">
      {/* Actions (hidden when printing) */}
      <div className="no-print flex items-center justify-between">
        <Link href="/pos" className="cd-btn-sec text-sm">← New sale</Link>
        <div className="flex gap-2">
          {canWhatsapp && <SendReceiptButton id={view.id} waUrl={waUrl} />}
          <PrintButton />
        </div>
      </div>

      {/* Sent status + shareable link */}
      <div className="no-print cd-card px-4 py-3 space-y-2">
        {view.sentAt ? (
          <div className="text-xs" style={{ color: '#4d6330' }}>
            ✓ Digital receipt sent{view.channel ? ` via ${view.channel}` : ''} · {view.sentAt.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        ) : (
          <div className="text-xs cd-muted">
            {canWhatsapp ? 'Not sent yet — tap “WhatsApp receipt” to share.' : 'Add a phone number to the customer to WhatsApp the receipt.'}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input readOnly value={publicUrl} className="cd-input text-xs" style={{ flex: 1 }} />
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="cd-btn-sec text-xs whitespace-nowrap">Open link</a>
        </div>
        <p className="text-xs cd-muted">Anyone with this link can view the receipt — no login needed.</p>
      </div>

      <ReceiptCard view={view} business={config.business} />
    </div>
  )
}
