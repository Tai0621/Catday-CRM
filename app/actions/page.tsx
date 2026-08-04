import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildActionInbox, type ActionCard } from '@/lib/actions'
import type { TypeStats } from '@/lib/actions-learning'
import { buildAttribution, type Attribution } from '@/lib/attribution'
import { getConfig, fmtMoney, type AppConfig } from '@/lib/config'
import { ACTION_SEGMENT } from '@/lib/segments'
import type { ActionType } from '@/lib/constants'
import { whatsappUrl } from '@/lib/phone'
import { ACTION_SNOOZE_DAYS } from '@/lib/constants'
import { SEGMENTS, SEGMENT_LIST, type SegmentKey } from '@/lib/segments'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ seg?: string }> }) {
  await requireAuth()
  const { seg } = await searchParams
  const activeSeg = (seg && seg in SEGMENTS ? seg : null) as SegmentKey | null
  const [{ queue: fullQueue, stats, suppressed }, attribution, cfg] = await Promise.all([
    buildActionInbox(), buildAttribution(), getConfig(),
  ])
  const queue = activeSeg ? fullQueue.filter(a => a.segment === activeSeg) : fullQueue
  const countBySeg = new Map<SegmentKey, number>()
  for (const a of fullQueue) countBySeg.set(a.segment, (countBySeg.get(a.segment) ?? 0) + 1)

  async function logAction(data: FormData) {
    'use server'
    const status = data.get('status') as string
    const snoozeUntil = status === 'Snoozed'
      ? new Date(Date.now() + ACTION_SNOOZE_DAYS * 24 * 60 * 60 * 1000)
      : null
    await db.actionLog.create({
      data: {
        actionKey: data.get('actionKey') as string,
        type: data.get('type') as string,
        customerId: (data.get('customerId') as string) || null,
        catId: (data.get('catId') as string) || null,
        status,
        snoozeUntil,
        // C4 · without this the variant test is blind — the arm must be recorded
        // at the moment the outcome is logged, not inferred later.
        variant: (data.get('variant') as string) || null,
      },
    })
    revalidatePath('/actions')
  }

  const bands: ActionCard['band'][] = ['Do now', 'This week', 'Opportunities']
  const byBand = Object.fromEntries(bands.map(b => [b, queue.filter(a => a.band === b)])) as Record<ActionCard['band'], ActionCard[]>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Action Inbox</h1>
        <p className="text-sm cd-muted">
          {queue.length === 0
            ? 'All clear — the CRM found nothing that needs attention right now.'
            : `${queue.length} suggested action${queue.length === 1 ? '' : 's'}, most important first. Each one comes with a ready-to-send message.`}
        </p>
      </div>

      {/* Segment filter — colour-coded by business area, so each role can work its own lane */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/actions"
          className="cd-pill"
          style={!activeSeg
            ? { background: '#2D1907', color: '#ECDBB6' }
            : { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
          All · {fullQueue.length}
        </Link>
        {SEGMENT_LIST.map(s => {
          const n = countBySeg.get(s.key) ?? 0
          if (n === 0 && activeSeg !== s.key) return null
          const on = activeSeg === s.key
          return (
            <Link key={s.key} href={`/actions?seg=${s.key}`}
              className="cd-pill inline-flex items-center gap-1.5"
              style={on ? { background: s.color, color: '#F2EDE0' } : { background: s.bg, color: s.text }}>
              <span className="rounded-full" style={{ width: 6, height: 6, background: on ? '#F2EDE0' : s.color }} />
              {s.label} · {n}
            </Link>
          )
        })}
      </div>

      {queue.length === 0 && (
        <div className="cd-card py-16 text-center">
          <div className="text-3xl mb-2">🐾</div>
          <p className="cd-muted text-sm">
            {activeSeg ? 'Nothing pending in this segment.' : 'Inbox zero. Check back tomorrow — the queue rebuilds itself from live data.'}
          </p>
        </div>
      )}

      <WhatsWorking stats={stats} suppressed={suppressed} attribution={attribution} cfg={cfg} />

      {bands.map(bandName => {
        const items = byBand[bandName]
        if (items.length === 0) return null
        return (
          <section key={bandName}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-wider" style={{ color: bandName === 'Do now' ? '#B14919' : '#2D1907', letterSpacing: '0.08em' }}>
                {bandName}
              </h2>
              <span className="cd-pill" style={{ background: bandName === 'Do now' ? 'rgba(177,73,25,0.15)' : 'rgba(45,25,7,0.08)', color: bandName === 'Do now' ? '#B14919' : 'rgba(45,25,7,0.6)' }}>
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.map(a => (
                <div key={a.key} className="cd-card p-4 flex flex-wrap items-center gap-3"
                  style={{ borderLeft: `3px solid ${SEGMENTS[a.segment].color}` }}>
                  <div className="flex-1 min-w-0" style={{ minWidth: '14rem' }}>
                    <p className="text-sm font-semibold truncate" style={{ color: '#2D1907' }}>
                      {a.customerId ? (
                        <Link href={`/customers/${a.customerId}`} className="hover:underline">{a.title}</Link>
                      ) : a.title}
                    </p>
                    <p className="text-xs truncate">
                      <span className="font-medium" style={{ color: SEGMENTS[a.segment].text }}>{SEGMENTS[a.segment].label}</span>
                      <span className="cd-muted"> · {a.reason}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {a.phone && a.waMessage && (
                      <a href={whatsappUrl(a.phone, a.waMessage)} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-90 transition-opacity"
                        style={{ background: '#729094', color: '#F2EDE0' }}>
                        WhatsApp
                      </a>
                    )}
                    {a.href && (
                      <Link href={a.href} className="text-xs px-3 py-1.5 rounded-lg cd-btn-sec">Open</Link>
                    )}
                    <ActionButtons a={a} logAction={logAction} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// Sentence case to match the band headings ("Do now", "This week"), with the one
// acronym the action types contain kept upright.
const typeLabel = (t: string) =>
  t.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+(\w)/g, (_, c: string) => ` ${c.toLowerCase()}`)
    .replace(/^Vip\b/, 'VIP')
const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * What the inbox has learned. Ranking silently on hidden statistics is how a
 * system loses the room — if the queue reorders itself, staff get to see the
 * record it reordered on, and the sample size behind it.
 */
function WhatsWorking({ stats, suppressed, attribution, cfg }: {
  stats: Map<ActionType, TypeStats>
  suppressed: { type: ActionType; held: number }[]
  attribution: Attribution
  cfg: AppConfig
}) {
  const measured = [...stats.values()]
    .filter(s => s.measured)
    .sort((a, b) => (b.hasOutcomeWindow ? b.conversionRate : b.acceptance) - (a.hasOutcomeWindow ? a.conversionRate : a.acceptance))

  if (measured.length === 0 && suppressed.length === 0) return null

  return (
    <details className="cd-card p-4">
      <summary className="cursor-pointer text-sm font-semibold" style={{ color: '#2D1907' }}>
        What&rsquo;s working
        <span className="cd-muted font-normal"> · ranking is tuned by these results</span>
      </summary>

      {attribution.totalAttributedRM > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-3"
          style={{ borderBottom: '1px solid rgba(45,25,7,0.12)' }}>
          <span className="text-lg font-bold" style={{ color: '#2D1907' }}>
            {fmtMoney(attribution.totalAttributedRM, cfg)}
          </span>
          <span className="text-xs cd-muted">
            attributed to these nudges over the past year, against {fmtMoney(attribution.totalSpendRM, cfg)} of messaging
          </span>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {measured.map(s => {
          const seg = SEGMENTS[ACTION_SEGMENT[s.type]]
          const money = attribution.byType.get(s.type)
          return (
            <div key={s.type} className="flex items-center gap-2 text-xs">
              <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: seg.color }} />
              <span className="flex-1 min-w-0 truncate" style={{ color: '#2D1907' }}>{typeLabel(s.type)}</span>
              {money && money.attributedRM > 0 && (
                <span className="font-semibold" style={{ color: '#2D1907' }}>{fmtMoney(money.attributedRM, cfg)}</span>
              )}
              {s.hasOutcomeWindow && (
                <span className="cd-pill" style={{ background: seg.bg, color: seg.text }}>
                  {pct(s.conversionRate)} booked
                </span>
              )}
              <span className="cd-muted">{pct(s.acceptance)} actioned</span>
              <span className="cd-muted" style={{ minWidth: '3.5rem', textAlign: 'right' }}>n={s.sample}</span>
            </div>
          )
        })}
        {measured.length === 0 && (
          <p className="text-xs cd-muted">Not enough history yet — the queue is still ranking on its default order.</p>
        )}
      </div>

      {attribution.totalAttributedRM > 0 && (
        <p className="mt-3 text-xs cd-muted">
          Revenue is <span className="font-medium">attributed, not incremental</span> — a customer who would have
          booked anyway still counts, and each sale is credited only to the most recent nudge before it. Read it
          as an upper bound.
        </p>
      )}

      {suppressed.length > 0 && (
        <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid rgba(45,25,7,0.12)' }}>
          <span className="font-medium" style={{ color: '#B14919' }}>Held back: </span>
          <span className="cd-muted">
            {suppressed.map(s => `${typeLabel(s.type)} (${s.held})`).join(', ')} — consistently ignored, so
            they are kept out of the queue. Urgent actions are never held back.
          </span>
        </div>
      )}
    </details>
  )
}

function ActionButtons({ a, logAction }: { a: ActionCard; logAction: (fd: FormData) => Promise<void> }) {
  return (
    <>
      {(['Done', 'Snoozed', 'Dismissed'] as const).map(status => (
        <form key={status} action={logAction}>
          <input type="hidden" name="actionKey" value={a.key} />
          <input type="hidden" name="type" value={a.type} />
          <input type="hidden" name="customerId" value={a.customerId ?? ''} />
          <input type="hidden" name="catId" value={a.catId ?? ''} />
          <input type="hidden" name="variant" value={a.variant ?? ''} />
          <input type="hidden" name="status" value={status} />
          <button type="submit"
            className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={status === 'Done'
              ? { background: 'rgba(114,144,148,0.18)', color: '#4a666a', border: '1px solid rgba(114,144,148,0.3)' }
              : { background: 'transparent', color: 'rgba(45,25,7,0.45)', border: '1px solid rgba(45,25,7,0.15)' }}
            title={status === 'Snoozed' ? 'Hide for 7 days' : status === 'Dismissed' ? 'Hide for 30 days' : 'Mark as handled'}>
            {status === 'Done' ? '✓ Done' : status === 'Snoozed' ? 'Snooze' : 'Dismiss'}
          </button>
        </form>
      ))}
    </>
  )
}
