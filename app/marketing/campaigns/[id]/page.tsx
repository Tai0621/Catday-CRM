import { requireManager } from '@/lib/auth'
import { worklistFor } from '@/lib/campaigns'
import { whatsappUrl } from '@/lib/phone'
import { MARKETING_FREQUENCY_CAP_DAYS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { markSent } from '../actions'
import { notFound } from 'next/navigation'
import Link from 'next/link'

// M1 · The send worklist.
//
// One customer at a time, each send confirmed. The WhatsApp integration is
// inbound-only, so this is the honest shape of "send a campaign" — and the page
// says so, rather than presenting a Send All button that would need approved
// templates, per-conversation billing and throttling behind it.
export default async function CampaignSendPage({ params }: { params: Promise<{ id: string }> }) {
  await requireManager()
  const { id } = await params
  const data = await worklistFor(id)
  if (!data) notFound()

  const { campaign, entries, blocked } = data
  const seg = SEGMENTS.community

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/marketing/campaigns" className="text-xs cd-muted hover:underline">Campaigns</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">{campaign.name}</span>
        </div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{campaign.name}</h1>
        <p className="text-sm cd-muted">
          {campaign.offerType}{campaign.discountPct > 0 ? ` · ${campaign.discountPct}% off` : ''} ·
          valid {campaign.validFrom.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
          {' – '}{campaign.validTo.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
        </p>
      </div>

      {campaign.status === 'Draft' && (
        <div className="cd-card p-4">
          <p className="text-sm" style={{ color: '#B14919' }}>
            This campaign has not been approved, so there is nothing to send. Approve it on the{' '}
            <Link href="/marketing/campaigns" className="cd-link">campaigns page</Link> first.
          </p>
        </div>
      )}

      <div className="cd-card p-4" style={{ borderLeft: `3px solid ${seg.color}` }}>
        <p className="text-sm" style={{ color: '#2D1907' }}>
          Sent one at a time, each confirmed. The WhatsApp integration here is inbound-only —
          bulk sending needs pre-approved templates and per-conversation billing, and a banned
          business number is not recoverable.
        </p>
        <p className="text-xs cd-muted mt-1">
          {campaign.sent} sent · {entries.length} left
          {blocked > 0 ? ` · ${blocked} skipped (no consent, or messaged within ${MARKETING_FREQUENCY_CAP_DAYS} days)` : ''}
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="cd-card py-10 text-center">
          <p className="text-sm cd-muted">
            {campaign.status === 'Draft'
              ? 'Nothing to send yet.'
              : 'Nobody left — everyone in this audience has been contacted, or has heard from you recently.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.customerId} className="cd-card p-4 space-y-2">
              <Link href={`/customers/${e.customerId}`} className="text-sm font-semibold cd-link">{e.name}</Link>
              <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>
                {e.text}
              </p>
              <div className="flex items-center gap-2">
                <a href={whatsappUrl(e.phone, e.text)} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: '#729094', color: '#F2EDE0' }}>Open WhatsApp</a>
                <form action={markSent}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="customerId" value={e.customerId} />
                  <button type="submit" className="text-xs cd-btn-sec">Mark as sent</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
