import { requireManager } from '@/lib/auth'
import { getConfig, fmtMoney } from '@/lib/config'
import { listCampaigns, campaignAudiences, MAX_PROPOSED_DISCOUNT_PCT } from '@/lib/campaigns'
import { groupByKey } from '@/lib/customer-groups'
import { SEGMENTS } from '@/lib/segments'
import { propose, approve, discard, end } from './actions'
import Link from 'next/link'

const iso = (d: Date) => d.toISOString().slice(0, 10)

// M1 · Campaign Studio.
//
// The owner describes an intent; the studio proposes offer structures against
// real capacity and real margin. Nothing sends until it is approved, and then
// only one customer at a time.
export default async function CampaignsPage() {
  await requireManager()
  const [campaigns, audiences, config] = await Promise.all([listCampaigns(), campaignAudiences(), getConfig()])
  const seg = SEGMENTS.community
  const configured = !!process.env.ANTHROPIC_API_KEY

  const today = new Date()
  const inFourWeeks = new Date(today.getTime() + 28 * 86400000)
  const drafts = campaigns.filter(c => c.status === 'Draft')
  const live = campaigns.filter(c => c.status !== 'Draft')

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Campaign Studio
        </h1>
        <p className="text-sm cd-muted">
          Describe what you want to fill. Offers are proposed against your real open capacity and
          real margin — and sent one customer at a time, never blasted.
        </p>
      </div>

      {configured ? (
        <form action={propose} className="cd-card p-5 space-y-3">
          <div>
            <label className="cd-label">What are you trying to do?</label>
            <textarea name="intent" rows={2} required minLength={10} className="cd-input"
              placeholder="e.g. fill Tuesday and Wednesday boarding next month" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="cd-label">From</label>
              <input name="from" type="date" required defaultValue={iso(today)} className="cd-input" />
            </div>
            <div>
              <label className="cd-label">To</label>
              <input name="to" type="date" required defaultValue={iso(inFourWeeks)} className="cd-input" />
            </div>
          </div>
          <button type="submit" className="cd-btn text-sm">Propose offers</button>
          <p className="text-xs cd-muted">
            Discounts are capped at {MAX_PROPOSED_DISCOUNT_PCT}%, and an offer aimed at days that are
            already busy is flagged rather than proposed. No revenue forecast is produced — nobody has
            measured a conversion rate yet, so any projection would be invented.
          </p>
        </form>
      ) : (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            No <code>ANTHROPIC_API_KEY</code> on this deployment, so offers cannot be proposed here.
          </p>
        </div>
      )}

      {audiences.length > 0 && (
        <div className="cd-card p-4">
          <p className="cd-label mb-1">Audiences available</p>
          <p className="text-xs cd-muted">
            {audiences.map(a => `${a.name} (${a.sendable} reachable of ${a.size})`).join(' · ')}
          </p>
        </div>
      )}

      {drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: '#2D1907' }}>Drafts — nothing sent</h2>
          {drafts.map(c => <Card key={c.id} campaign={c} config={config} />)}
        </section>
      )}

      {live.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: '#2D1907' }}>Approved and past</h2>
          {live.map(c => <Card key={c.id} campaign={c} config={config} />)}
        </section>
      )}

      {campaigns.length === 0 && (
        <div className="cd-card py-12 text-center">
          <p className="text-sm cd-muted">No campaigns yet.</p>
        </div>
      )}
    </div>
  )
}

function Card({ campaign, config }: { campaign: Awaited<ReturnType<typeof listCampaigns>>[number]; config: Awaited<ReturnType<typeof getConfig>> }) {
  const facts = campaign.facts as { economics?: Record<string, number | boolean | null>; targetWeekdays?: string[] }
  const e = facts.economics
  const group = campaign.targetGroupKey ? groupByKey(campaign.targetGroupKey) : null
  const risky = e?.cannibalisationRisk === true

  return (
    <section className="cd-card overflow-hidden" style={{ borderLeft: `3px solid ${risky ? '#B14919' : SEGMENTS.community.color}` }}>
      <div className="cd-section-header">
        <h3 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{campaign.name}</h3>
        <span className="cd-pill" style={campaign.status === 'Draft'
          ? { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }
          : { background: 'rgba(122,138,79,0.2)', color: '#5c6b3c' }}>{campaign.status}</span>
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-sm" style={{ color: '#2D1907' }}>
          {campaign.offerType}{campaign.discountPct > 0 ? ` · ${campaign.discountPct}% off` : ''}
          {group ? ` · ${group.name}` : ' · no audience chosen'}
          {facts.targetWeekdays?.length ? ` · ${facts.targetWeekdays.join(', ')}` : ''}
        </p>
        {campaign.rationale && <p className="text-xs cd-muted">{campaign.rationale}</p>}

        <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>
          {campaign.message}
        </p>

        {risky && (
          <p className="text-xs" style={{ color: '#B14919' }}>
            ⚠ Those days already run at {String(e?.targetedUtilisationPct)}% — a discount here mostly
            displaces bookings you would have taken at full price.
          </p>
        )}

        {e && (
          <div className="flex flex-wrap gap-4 text-xs cd-muted">
            <span>{fmtMoney(Number(e.contributionPerBookingRM ?? 0), config)} <span className="cd-muted">per booking after commission</span></span>
            <span>{fmtMoney(Number(e.campaignCostRM ?? 0), config)} <span className="cd-muted">to message the audience</span></span>
            {e.breakEvenBookings != null && (
              <span style={{ color: '#2D1907' }}>
                {String(e.breakEvenBookings)} booking{e.breakEvenBookings === 1 ? '' : 's'} to break even
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {campaign.status === 'Draft' && (
            <>
              <form action={approve}>
                <input type="hidden" name="id" value={campaign.id} />
                <button type="submit" className="cd-btn text-sm" disabled={!campaign.targetGroupKey}>
                  Approve
                </button>
              </form>
              <form action={discard}>
                <input type="hidden" name="id" value={campaign.id} />
                <button type="submit" className="text-xs cd-muted hover:underline">Discard</button>
              </form>
              {!campaign.targetGroupKey && (
                <span className="text-xs" style={{ color: '#B14919' }}>No audience — cannot be approved.</span>
              )}
            </>
          )}
          {(campaign.status === 'Approved' || campaign.status === 'Running') && (
            <>
              <Link href={`/marketing/campaigns/${campaign.id}`} className="cd-btn text-sm">
                Send list{campaign.sent > 0 ? ` · ${campaign.sent} sent` : ''}
              </Link>
              <form action={end}>
                <input type="hidden" name="id" value={campaign.id} />
                <button type="submit" className="text-xs cd-muted hover:underline">End</button>
              </form>
            </>
          )}
          {campaign.status === 'Ended' && campaign.sent > 0 && (
            <span className="text-xs cd-muted">{campaign.sent} sent</span>
          )}
        </div>
      </div>
    </section>
  )
}
