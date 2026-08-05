import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { getConfig, fmtMoney } from '@/lib/config'
import { pendingReferrals, referralStats } from '@/lib/referrals'
import { SEGMENTS } from '@/lib/segments'
import { creditReferralAction, linkReferralAction, issueCodeAction } from './actions'
import Link from 'next/link'

// M5 · Referrals — link one, then pay both sides once the new customer shows up.
//
// Crediting is a manager's click rather than an automatic checkout side effect;
// see the reasoning in lib/referrals.ts.
export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string }> }) {
  await requireManager()
  const { q, msg } = await searchParams

  const [config, stats, pending] = await Promise.all([getConfig(), referralStats(), pendingReferrals()])
  const seg = SEGMENTS.community

  // Codes are generated lazily, so the list only shows customers who have one.
  const withCodes = await db.customer.findMany({
    where: { referralCode: { not: null }, erasedAt: null },
    select: { id: true, name: true, phone: true, referralCode: true, referred: { select: { id: true } } },
    orderBy: { name: 'asc' },
    take: 25,
  })

  const searched = q
    ? await db.customer.findMany({
      where: { erasedAt: null, OR: [{ name: { contains: q } }, { phone: { contains: q } }] },
      select: { id: true, name: true, phone: true, referralCode: true },
      take: 8,
    })
    : []

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Referrals</h1>
        <p className="text-sm cd-muted">
          Give a customer a code, credit both sides once the person they sent actually visits.
          Credit lands in the wallet as a normal ledger entry.
        </p>
      </div>

      {msg && (
        <div className="cd-card p-3" style={{ borderLeft: '3px solid #B14919' }}>
          <p className="text-sm" style={{ color: '#2D1907' }}>{friendly(msg)}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Stat n={String(stats.pending)} label="waiting on a first visit" />
        <Stat n={String(stats.credited)} label="credited" strong />
        <Stat n={fmtMoney(stats.creditedRM, config)} label="paid out" />
        <Stat n={fmtMoney(stats.referredRevenueRM, config)} label="spent by referred customers" strong />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2D1907' }}>Ready to credit</h2>
        {pending.length === 0 ? (
          <div className="cd-card py-8 text-center"><p className="text-sm cd-muted">No referrals waiting.</p></div>
        ) : (
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="cd-card p-3 flex flex-wrap items-center gap-3"
                style={{ borderLeft: `3px solid ${r.eligible ? seg.color : 'rgba(45,25,7,0.15)'}` }}>
                <div className="flex-1 min-w-0" style={{ minWidth: '14rem' }}>
                  <p className="text-sm" style={{ color: '#2D1907' }}>
                    <span className="font-semibold">{r.referrerName}</span>
                    <span className="cd-muted"> brought in </span>
                    <span className="font-semibold">{r.referredName}</span>
                  </p>
                  <p className="text-xs cd-muted">
                    {r.eligible
                      ? `first visit ${r.firstVisitAt!.toLocaleDateString(config.currency.locale)} — payable`
                      : 'no completed visit yet'}
                  </p>
                </div>
                {r.eligible ? (
                  <form action={creditReferralAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="text-xs px-3 py-1.5 rounded-lg cd-btn">
                      Credit {fmtMoney(config.marketing.referrerCreditRM, config)} each
                    </button>
                  </form>
                ) : (
                  <span className="text-xs cd-muted">waiting</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cd-card p-4 space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: '#2D1907' }}>Record a referral</h2>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} className="cd-input flex-1" placeholder="Find the new customer by name or phone…" />
          <button type="submit" className="cd-btn-sec">Search</button>
        </form>
        {searched.map(c => (
          <form key={c.id} action={linkReferralAction} className="flex flex-wrap items-center gap-2">
            <span className="text-sm flex-1" style={{ color: '#2D1907' }}>{c.name ?? c.phone}</span>
            <input type="hidden" name="referredId" value={c.id} />
            <input name="code" className="cd-input" style={{ width: 140 }} placeholder="Referrer code" maxLength={12} required />
            <button type="submit" className="cd-btn text-sm">Link</button>
          </form>
        ))}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2D1907' }}>Codes issued</h2>
        <div className="cd-card p-4 space-y-2">
          {withCodes.length === 0 && (
            <p className="text-xs cd-muted">
              No codes yet — open a customer and issue one, or use the search above.
            </p>
          )}
          {withCodes.map(c => (
            <div key={c.id} className="flex items-center gap-3 text-sm">
              <Link href={`/customers/${c.id}`} className="flex-1 cd-link truncate">{c.name ?? c.phone}</Link>
              <code className="cd-pill" style={{ background: seg.bg, color: seg.text, fontFamily: 'var(--font-brand)' }}>
                {c.referralCode}
              </code>
              <span className="text-xs cd-muted" style={{ minWidth: '5rem', textAlign: 'right' }}>
                {c.referred.length} referred
              </span>
            </div>
          ))}
        </div>

        {searched.filter(c => !c.referralCode).length > 0 && (
          <div className="mt-2 space-y-1">
            {searched.filter(c => !c.referralCode).map(c => (
              <form key={c.id} action={issueCodeAction} className="flex items-center gap-2">
                <span className="text-xs cd-muted flex-1">{c.name ?? c.phone} has no code</span>
                <input type="hidden" name="customerId" value={c.id} />
                <button type="submit" className="text-xs px-2.5 py-1 rounded-lg cd-btn-sec">Issue code</button>
              </form>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function friendly(code: string): string {
  const m: Record<string, string> = {
    'self-referral': 'A customer cannot refer themselves.',
    'already-referred': 'That customer was already referred by someone else.',
    'circular-referral': 'Those two already refer each other — crediting both ways would be a loop.',
    'no-such-code': 'No customer has that referral code.',
    'no-completed-visit': 'The new customer has not completed a visit yet.',
    'already-settled': 'That referral was already credited.',
    'credit-not-configured': 'Referral credit is set to zero in Business Settings.',
  }
  return m[code] ?? 'That did not work.'
}

function Stat({ n, label, strong }: { n: string; label: string; strong?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-lg font-bold" style={{ color: strong ? SEGMENTS.community.text : '#2D1907' }}>{n}</div>
      <div className="text-xs cd-muted">{label}</div>
    </div>
  )
}
