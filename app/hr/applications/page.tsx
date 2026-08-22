import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { APPLICATION_STATUSES } from '@/lib/constants'
import { recordAudit } from '@/lib/audit'
import { absoluteUrl } from '@/lib/base-url'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

const OPEN = ['New', 'Reviewing', 'Interview']

// HR · Applications. Candidate pipeline fed by the public /careers form.
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireManager()
  const { status } = await searchParams
  const filter = (APPLICATION_STATUSES as readonly string[]).includes(status ?? '') ? status! : 'open'

  const [all, careersUrl] = await Promise.all([
    db.jobApplication.findMany({ orderBy: { createdAt: 'desc' } }),
    absoluteUrl('/careers'),
  ])
  const counts = Object.fromEntries(APPLICATION_STATUSES.map(s => [s, all.filter(a => a.status === s).length]))
  const shown = filter === 'open' ? all.filter(a => OPEN.includes(a.status)) : all.filter(a => a.status === filter)

  async function updateApplication(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const next = data.get('status') as string
    const notes = ((data.get('notes') as string) ?? '').trim() || null
    if (!(APPLICATION_STATUSES as readonly string[]).includes(next)) return
    const app = await db.jobApplication.update({ where: { id }, data: { status: next, notes, reviewedAt: new Date() } })
    await recordAudit({ action: 'application.status', entityType: 'JobApplication', entityId: id, summary: `${app.name} → ${next}` })
    revalidatePath('/hr/applications')
  }

  const seg = SEGMENTS.boarding
  const chip = (label: string, key: string, count: number) => (
    <a href={`/hr/applications?status=${key}`} className="cd-pill" style={filter === key
      ? { background: '#B14919', color: '#F2EDE0' }
      : { background: 'rgba(45,25,7,0.07)', color: '#2D1907' }}>
      {label} {count > 0 && <strong>· {count}</strong>}
    </a>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs cd-muted">Human Resource</span><span className="text-xs cd-muted">›</span><span className="text-xs cd-muted">Applications</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Applications
        </h1>
        <p className="text-sm cd-muted">
          Share your careers form: <a href={careersUrl} target="_blank" rel="noopener noreferrer" className="cd-link">{careersUrl}</a>
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {chip('Open', 'open', OPEN.reduce((s, k) => s + (counts[k] ?? 0), 0))}
        {APPLICATION_STATUSES.map(s => chip(s, s, counts[s] ?? 0))}
      </div>

      {shown.length === 0 ? (
        <div className="cd-card px-4 py-10 text-sm cd-muted text-center">No applications here yet.</div>
      ) : (
        <div className="space-y-3">
          {shown.map(a => (
            <div key={a.id} className="cd-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold" style={{ color: '#2D1907' }}>{a.name}
                    {a.roleApplied && <span className="cd-muted font-normal"> · {a.roleApplied}</span>}
                  </div>
                  <div className="text-xs cd-muted">
                    <a href={whatsappUrl(a.phone)} target="_blank" rel="noopener noreferrer" className="cd-link">{displayPhone(a.phone)}</a>
                    {a.email && <> · {a.email}</>}
                    {' · '}applied {a.createdAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <span className="cd-pill shrink-0" style={statusStyle(a.status)}>{a.status}</span>
              </div>
              {a.availability && <div className="text-sm" style={{ color: '#2D1907' }}><span className="cd-muted">Availability:</span> {a.availability}</div>}
              {a.experience && <div className="text-sm" style={{ color: '#2D1907' }}><span className="cd-muted">Experience:</span> {a.experience}</div>}

              <form action={updateApplication} className="flex flex-wrap items-end gap-2 pt-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
                <input type="hidden" name="id" value={a.id} />
                <div>
                  <label className="cd-label">Move to</label>
                  <select name="status" defaultValue={a.status} className="cd-input" style={{ width: '9rem' }}>
                    {APPLICATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <input name="notes" defaultValue={a.notes ?? ''} className="cd-input" style={{ flex: 1, minWidth: '10rem' }} placeholder="Internal notes" />
                <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Save</SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function statusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    New: { background: 'rgba(114,144,148,0.2)', color: '#4a666a' },
    Reviewing: { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    Interview: { background: 'rgba(184,144,43,0.16)', color: '#8a6c00' },
    Hired: { background: 'rgba(95,122,63,0.18)', color: '#4d6330' },
    Rejected: { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.5)' },
  }
  return m[s] ?? {}
}
