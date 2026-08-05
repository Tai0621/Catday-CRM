import { requireManager } from '@/lib/auth'
import { SYSTEM_GROUPS, evaluateGroup } from '@/lib/customer-groups'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'

// M10 · The audiences you can target, with live counts.
//
// Each row shows three numbers deliberately: how many match, how many of those
// may legally be messaged, and how many are held back by the frequency cap. A
// single "audience size" would hide the fact that most of it is unreachable.
export default async function GroupsPage() {
  await requireManager()

  const audiences = await Promise.all(
    SYSTEM_GROUPS.map(async g => ({ group: g, audience: await evaluateGroup(g) })),
  )
  const seg = SEGMENTS.community

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Customer groups</h1>
        <p className="text-sm cd-muted">
          Saved audiences, re-checked every time you open one — never a stale list. Only customers who
          agreed to marketing can be messaged, and nobody is contacted twice in a fortnight.
        </p>
      </div>

      <div className="space-y-2">
        {audiences.map(({ group, audience }) => (
          <Link key={group.key} href={`/marketing/groups/${group.key}`}
            className="cd-card p-4 flex flex-wrap items-center gap-3 hover:opacity-90 transition-opacity"
            style={{ borderLeft: `3px solid ${seg.color}` }}>
            <div className="flex-1 min-w-0" style={{ minWidth: '16rem' }}>
              <p className="text-sm font-semibold" style={{ color: '#2D1907' }}>{group.name}</p>
              <p className="text-xs cd-muted">{group.description}</p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="text-right">
                <div className="font-bold text-base" style={{ color: '#2D1907' }}>{audience.total}</div>
                <div className="cd-muted">match</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-base" style={{ color: seg.text }}>{audience.sendable.length}</div>
                <div className="cd-muted">can message</div>
              </div>
              {audience.cappedOut > 0 && (
                <div className="text-right">
                  <div className="font-bold text-base" style={{ color: 'rgba(45,25,7,0.35)' }}>{audience.cappedOut}</div>
                  <div className="cd-muted">too recent</div>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs cd-muted">
        Building your own audiences from scratch is coming — these cover the ones that matter most for a
        grooming and boarding business.
      </p>
    </div>
  )
}
