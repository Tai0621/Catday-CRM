import { requireManager } from '@/lib/auth'
import { listAudit } from '@/lib/audit'
import { SEGMENTS } from '@/lib/segments'

// Administrative · Audit Log. Read-only, manager-only record of sensitive
// actions (sale deletions, staff & PIN changes, wallet/loyalty adjustments).
export default async function AuditPage() {
  await requireManager()
  const entries = await listAudit(200)
  const seg = SEGMENTS.business

  const rel = (d: Date) => {
    const s = Math.floor((Date.now() - d.getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs cd-muted">Administrative</span>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Audit Log</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Audit Log
        </h1>
        <p className="text-sm cd-muted">
          Who did what, and when — sale deletions, staff &amp; PIN changes, and wallet/loyalty adjustments.
          Most recent {entries.length === 200 ? '200' : entries.length} shown.
        </p>
      </div>

      <div className="cd-card overflow-hidden">
        {entries.length === 0 ? (
          <p className="px-4 py-10 text-sm cd-muted text-center">No audited actions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead">
                <th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th>
              </tr></thead>
              <tbody className="cd-tbody">
                {entries.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: '#2D1907' }}>
                      <span title={e.at.toLocaleString('en-MY')}>{rel(e.at)}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium" style={{ color: '#2D1907' }}>{e.actorName}</span>
                      <span className="cd-muted"> · {e.actorKind}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="cd-pill" style={actionStyle(e.action)}>{e.action}</span>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: '#2D1907' }}>{e.summary}</td>
                    <td className="px-4 py-2.5 cd-muted whitespace-nowrap">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function actionStyle(action: string): React.CSSProperties {
  const cat = action.split('.')[0]
  const seg =
    cat === 'transaction' ? SEGMENTS.business
    : cat === 'staff' ? SEGMENTS.community
    : cat === 'wallet' || cat === 'loyalty' ? SEGMENTS.membership
    : SEGMENTS.grooming
  return { background: seg.bg, color: seg.text }
}
