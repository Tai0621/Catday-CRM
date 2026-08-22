import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { reviewFunnel, newReviewToken } from '@/lib/reviews'
import { absoluteUrl } from '@/lib/base-url'
import { whatsappUrl } from '@/lib/phone'
import { MARKETING_FREQUENCY_CAP_DAYS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { createReviewRequest } from './actions'
import Link from 'next/link'
import { SubmitButton } from '@/app/components/Pending'

const DAY = 24 * 60 * 60 * 1000
const pct = (n: number) => `${Math.round(n * 100)}%`

// M4 · Ask recently-groomed customers how it went, and watch the funnel.
//
// Candidates are completed visits from the last week whose customer has not
// already been asked recently — a review request is still an outbound message,
// so it respects the same restraint as everything else in Marketing.
export default async function ReviewsPage() {
  await requireManager()
  const now = new Date()

  const [config, funnel, recent, asked] = await Promise.all([
    getConfig(),
    reviewFunnel(),
    db.appointment.findMany({
      where: {
        status: 'Completed',
        scheduledAt: { gte: new Date(now.getTime() - 7 * DAY), lte: now },
      },
      select: {
        id: true, scheduledAt: true, type: true,
        cat: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true, marketingConsent: true, erasedAt: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 40,
    }),
    db.reviewRequest.findMany({
      where: { sentAt: { gte: new Date(now.getTime() - 90 * DAY) } },
      select: { customerId: true, sentAt: true },
    }),
  ])

  const askedRecently = new Set(
    asked.filter(a => a.sentAt >= new Date(now.getTime() - MARKETING_FREQUENCY_CAP_DAYS * DAY))
      .map(a => a.customerId),
  )

  // Same floor as every other outbound surface: consent, not erased, not
  // contacted too recently.
  const candidates = recent.filter(a =>
    a.customer.marketingConsent && !a.customer.erasedAt && !askedRecently.has(a.customer.id))

  const reviewUrl = config.marketing.reviewUrl.trim()
  const seg = SEGMENTS.community

  const pending = await db.reviewRequest.findMany({
    where: { respondedAt: null },
    select: { id: true, token: true, sentAt: true, customer: { select: { name: true, phone: true } } },
    orderBy: { sentAt: 'desc' },
    take: 20,
  })

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Reviews</h1>
        <p className="text-sm cd-muted">
          Ask how the visit went before asking for a review. Happy customers get the public link;
          anything less becomes an incident the team can actually fix.
        </p>
      </div>

      {!reviewUrl && (
        <div className="cd-card p-4" style={{ borderLeft: '3px solid #B14919' }}>
          <p className="text-sm" style={{ color: '#2D1907' }}>
            No public review link set, so happy customers see a thank-you and nowhere to go.
          </p>
          <p className="text-xs cd-muted mt-1">
            Add your Google Business review URL in <Link href="/admin/settings" className="cd-link">Business Settings</Link>.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Stat n={String(funnel.sent)} label="asked" />
        <Stat n={pct(funnel.responseRate)} label="answered" strong />
        <Stat n={pct(funnel.positiveRate)} label="went well" />
        <Stat n={pct(funnel.clickThroughRate)} label="left a review" strong />
        {funnel.negative > 0 && <Stat n={String(funnel.negative)} label="became incidents" />}
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2D1907' }}>
          Ask about a recent visit <span className="cd-muted font-normal">· last 7 days</span>
        </h2>
        {candidates.length === 0 ? (
          <div className="cd-card py-8 text-center">
            <p className="text-sm cd-muted">
              Nobody to ask — either no completed visits this week, or everyone eligible has been asked recently.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map(a => (
              <div key={a.id} className="cd-card p-3 flex flex-wrap items-center gap-3"
                style={{ borderLeft: `3px solid ${seg.color}` }}>
                <div className="flex-1 min-w-0" style={{ minWidth: '12rem' }}>
                  <p className="text-sm font-semibold truncate" style={{ color: '#2D1907' }}>
                    {a.customer.name ?? a.customer.phone}
                  </p>
                  <p className="text-xs cd-muted">
                    {a.type} · {a.cat.name} · {a.scheduledAt.toLocaleDateString(config.currency.locale)}
                  </p>
                </div>
                <form action={createReviewRequest}>
                  <input type="hidden" name="customerId" value={a.customer.id} />
                  <input type="hidden" name="appointmentId" value={a.id} />
                  <SubmitButton className="text-xs px-3 py-1.5 rounded-lg cd-btn" busyLabel="Working…">Create request</SubmitButton>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#2D1907' }}>
            Waiting for an answer <span className="cd-muted font-normal">· send the link over WhatsApp</span>
          </h2>
          <div className="space-y-2">
            {await Promise.all(pending.map(async r => {
              const link = await absoluteUrl(`/review/${r.token}`)
              const text = `Hi! How was ${config.business.name} today? One quick question 🐾 ${link}`
              return (
                <div key={r.id} className="cd-card p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0" style={{ minWidth: '12rem' }}>
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D1907' }}>
                      {r.customer.name ?? r.customer.phone}
                    </p>
                    <p className="text-xs cd-muted">asked {r.sentAt.toLocaleDateString(config.currency.locale)}</p>
                  </div>
                  <a href={whatsappUrl(r.customer.phone, text)} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: '#729094', color: '#F2EDE0' }}>
                    Send link
                  </a>
                </div>
              )
            }))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ n, label, strong }: { n: string; label: string; strong?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xl font-bold" style={{ color: strong ? SEGMENTS.community.text : '#2D1907' }}>{n}</div>
      <div className="text-xs cd-muted">{label}</div>
    </div>
  )
}
