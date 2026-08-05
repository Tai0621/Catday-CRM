import { requireManager, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { groupByKey, evaluateGroup, renderMessage } from '@/lib/customer-groups'
import { whatsappUrl } from '@/lib/phone'
import { segmentStyle } from '@/lib/intelligence'
import { SEGMENTS } from '@/lib/segments'
import { MARKETING_FREQUENCY_CAP_DAYS } from '@/lib/constants'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import Link from 'next/link'

// M10 · One audience, and the worklist for actually reaching it.
//
// This is an ASSISTED send, not a bulk blast, and that is a deliberate limit
// rather than an unfinished feature: the WhatsApp integration is inbound-only,
// and outbound at scale needs pre-approved templates, per-conversation billing
// and throttling. A banned business number is unrecoverable. Staff work the list
// one customer at a time, and each confirmed send is logged — which is what
// feeds the frequency cap and M2's attribution.
export default async function GroupPage({ params }: { params: Promise<{ key: string }> }) {
  await requireManager()
  const { key } = await params
  const group = groupByKey(key)
  if (!group) notFound()

  const [audience, config] = await Promise.all([evaluateGroup(group), getConfig()])
  const seg = SEGMENTS.community
  const brand = config.business.name

  async function markSent(data: FormData) {
    'use server'
    await requireManager()
    const session = await getSession()
    const customerId = String(data.get('customerId') ?? '')
    const groupKey = String(data.get('groupKey') ?? '')
    if (!customerId || !groupByKey(groupKey)) return

    // Logged only on explicit confirmation. Writing this when the worklist is
    // opened would let an unsent message suppress a later real one for a
    // fortnight.
    await db.groupSend.create({
      data: {
        groupKey, customerId, channel: 'WhatsApp',
        staffId: session?.kind === 'staff' ? session.staffId : null,
      },
    })
    revalidatePath(`/marketing/groups/${groupKey}`)
  }

  const unreachable = audience.total - audience.consented

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/marketing/groups" className="text-xs cd-muted hover:underline">Customer groups</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">{group.name}</span>
        </div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{group.name}</h1>
        <p className="text-sm cd-muted">{group.description}</p>
      </div>

      <div className="cd-card p-4" style={{ borderLeft: `3px solid ${seg.color}` }}>
        <p className="text-sm" style={{ color: '#2D1907' }}>{group.intent}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Stat n={audience.total} label="match the rules" />
        <Stat n={audience.sendable.length} label="ready to message" strong />
        {audience.cappedOut > 0 && <Stat n={audience.cappedOut} label={`messaged in the last ${MARKETING_FREQUENCY_CAP_DAYS} days`} />}
        {unreachable > 0 && <Stat n={unreachable} label="no marketing consent" />}
      </div>

      {unreachable > 0 && (
        <p className="text-xs cd-muted">
          {unreachable} {unreachable === 1 ? 'customer matches' : 'customers match'} this audience but never
          agreed to marketing, so they are excluded from the list below. That is a legal floor, not a setting.
        </p>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#2D1907' }}>
          Send list <span className="cd-muted font-normal">· one at a time, each send logged</span>
        </h2>

        {audience.sendable.length === 0 ? (
          <div className="cd-card py-10 text-center">
            <p className="text-sm cd-muted">
              Nobody to message right now — either the audience is empty, or everyone in it has heard from
              you recently.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {audience.sendable.map(m => {
              const text = renderMessage(group.message, {
                customer: m.name, cat: m.catName ?? 'your cat', brand,
              })
              const style = segmentStyle(m.intel.segment)
              return (
                <div key={m.id} className="cd-card p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/customers/${m.id}`} className="text-sm font-semibold cd-link">{m.name}</Link>
                    <span className="cd-pill" style={style}>{m.intel.segment}</span>
                    <span className="text-xs cd-muted">
                      {m.intel.daysSinceLastVisit == null ? 'never visited' : `last visit ${m.intel.daysSinceLastVisit}d ago`}
                      {' · '}{m.intel.visits} visit{m.intel.visits === 1 ? '' : 's'}
                    </span>
                  </div>

                  <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>
                    {text}
                  </p>

                  <div className="flex items-center gap-2">
                    <a href={whatsappUrl(m.phone, text)} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: '#729094', color: '#F2EDE0' }}>
                      Open WhatsApp
                    </a>
                    <form action={markSent}>
                      <input type="hidden" name="customerId" value={m.id} />
                      <input type="hidden" name="groupKey" value={group.key} />
                      <button type="submit" className="text-xs px-3 py-1.5 rounded-lg cd-btn-sec">
                        Mark as sent
                      </button>
                    </form>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xl font-bold" style={{ color: strong ? SEGMENTS.community.text : '#2D1907' }}>{n}</div>
      <div className="text-xs cd-muted">{label}</div>
    </div>
  )
}
