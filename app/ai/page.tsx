import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { budgetState } from '@/lib/ai/budget'
import { aiProvider, aiModel, aiConfigured } from '@/lib/ai/provider'
import { destinations, assists } from '@/lib/ai/surfaces'
import { getConfig } from '@/lib/config'
import { zonedDayKey } from '@/lib/timezone'

// The AI space.
//
// One front door for everything the model does, because the alternative — which
// is what this replaces — is AI appearing in five unrelated corners of the nav
// with no way to see it whole, no single place to turn it down, and no answer
// to "what has it been doing?".
//
// Deliberately NOT a relocation of every feature. The destinations below open
// from here; the assists are listed and launched from here but keep living
// beside the data and the consent gates they depend on. See lib/ai/surfaces.ts.

const INK = '#2D1907'
const ACCENT = '#B14919'
const TEAL = '#729094'

export default async function AiHubPage() {
  await requireManager()

  const [budget, config] = await Promise.all([budgetState(), getConfig()])
  const configured = aiConfigured()
  const today = zonedDayKey(new Date(), config.timezone)

  const [latestBrief, latestReports, pendingProposals, usage] = await Promise.all([
    db.dailyBrief.findFirst({ orderBy: { date: 'desc' }, select: { date: true, model: true } }),
    db.monthlyReport.findMany({
      where: { month: { not: '' } },
      orderBy: { month: 'desc' }, take: 6,
      select: { month: true, department: true, status: true },
    }),
    db.aiProposal.count({ where: { status: 'Pending' } }).catch(() => 0),
    db.aiUsage.findUnique({ where: { date: today }, select: { calls: true } }).catch(() => null),
  ])

  const latestMonth = latestReports[0]?.month ?? null
  const thisMonth = latestReports.filter(r => r.month === latestMonth)
  const published = thisMonth.filter(r => r.status === 'Published').length
  const flagged = thisMonth.filter(r => r.status === 'Flagged').length

  const pct = budget.limit > 0 ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : 0

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        {/* Named to match the sidebar section it sits under. The route stays
            /ai — renaming it would break every stored role path pointing at it. */}
        <h1 className="text-xl font-bold" style={{ color: INK }}>Intelligence</h1>
        <p className="text-sm cd-muted">
          Everything the assistant does for {config.business.name}, and what it costs to run.
        </p>
      </div>

      {/* ── Governance first. What is switched on, on what, and how much is left. ── */}
      <section className="cd-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold" style={{ color: INK }}>Status</h2>
            <p className="text-sm cd-muted">
              {!configured
                ? 'No model provider key on this deployment — every AI feature is switched off and fails closed.'
                : budget.limit === 0
                  ? 'The AI budget is set to zero, which switches the assistant off entirely.'
                  : <>Running on <strong style={{ color: INK }}>{aiProvider()}</strong> · <code className="text-xs">{aiModel()}</code></>}
            </p>
          </div>
          <Link href="/settings" className="cd-btn-sec text-sm">Change budget</Link>
        </div>

        {configured && budget.limit > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span style={{ color: INK }}>
                {budget.used.toLocaleString()} of {budget.limit.toLocaleString()} tokens today
                {usage?.calls ? ` · ${usage.calls} call${usage.calls === 1 ? '' : 's'}` : ''}
              </span>
              <span className="cd-muted">{budget.remaining.toLocaleString()} left</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(45,25,7,0.08)' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: pct >= 90 ? ACCENT : TEAL, transition: 'width .3s',
              }} />
            </div>
            {!budget.enabled && (
              <p className="text-xs" style={{ color: ACCENT }}>
                Today&rsquo;s budget is spent. The assistant resumes tomorrow, or raise the limit in Settings.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── The destinations: the AI's own output ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: INK }}>Written by the AI</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {destinations().map(s => (
            <Link key={s.key} href={s.href} className="cd-card p-4 block transition-colors"
              style={{ borderLeft: `3px solid ${ACCENT}` }}>
              <div className="font-semibold text-sm mb-1" style={{ color: INK }}>{s.label}</div>
              <p className="text-xs cd-muted leading-relaxed">{s.what}</p>
              <div className="text-xs mt-2" style={{ color: TEAL }}>
                {s.key === 'brief' && (latestBrief ? `Latest: ${latestBrief.date}` : 'None written yet')}
                {s.key === 'reports' && (latestMonth
                  ? `${latestMonth} · ${published} published${flagged ? `, ${flagged} flagged` : ''}`
                  : 'None generated yet')}
                {s.key === 'ask' && (pendingProposals > 0
                  ? `${pendingProposals} draft${pendingProposals === 1 ? '' : 's'} awaiting your confirmation`
                  : 'Ask anything about the business')}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── The assists: AI inside a business workflow, left where it belongs ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: INK }}>AI at work elsewhere in the OS</h2>
        <p className="text-xs cd-muted">
          These stay beside the data they read — a consent check belongs next to the customer record it
          protects, not in a separate AI tab. They are listed here so nothing the model does is hidden.
        </p>
        <div className="cd-card divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
          {assists().map(s => (
            <Link key={s.key} href={s.href} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="text-sm font-medium" style={{ color: INK }}>{s.label}</div>
                <p className="text-xs cd-muted leading-relaxed">{s.what}</p>
                {s.whyThere && (
                  <p className="text-xs mt-0.5" style={{ color: TEAL }}>Lives in the OS because: {s.whyThere}</p>
                )}
              </div>
              <span className="text-xs cd-link whitespace-nowrap mt-0.5">Open →</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-xs cd-muted">
        Nothing here sends a message, posts a photo or charges a customer on its own. The assistant
        drafts; a person confirms.
      </p>
    </div>
  )
}
