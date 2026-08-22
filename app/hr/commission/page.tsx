import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { computeCommission, setCommissionDefault } from '@/lib/commission'
import { recordAudit } from '@/lib/audit'
import { GROOMING_APPT_TYPES } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

const rm = (n: number) => `RM ${n.toFixed(2)}`
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' }) }
const shift = (m: string, by: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

// HR · Commission. Per-groomer earnings for the month + the rate configuration.
export default async function CommissionPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireManager()
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { month: qMonth } = await searchParams
  const month = /^\d{4}-\d{2}$/.test(qMonth ?? '') ? qMonth! : thisMonth

  const [report, staff, services] = await Promise.all([
    computeCommission(month),
    db.staff.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true, commissionRatePct: true } }),
    db.service.findMany({ where: { active: true, category: { in: [...GROOMING_APPT_TYPES] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, price: true, commissionRatePct: true } }),
  ])

  async function saveConfig(data: FormData) {
    'use server'
    const parseRate = (v: FormDataEntryValue | null) => {
      const s = ((v as string) ?? '').trim()
      if (s === '') return null
      const n = Number(s)
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
    }
    await setCommissionDefault(parseRate(data.get('default')) ?? 0)
    const staffRows = await db.staff.findMany({ where: { active: true }, select: { id: true } })
    const serviceRows = await db.service.findMany({ where: { active: true, category: { in: [...GROOMING_APPT_TYPES] } }, select: { id: true } })
    await db.$transaction([
      ...staffRows.map(s => db.staff.update({ where: { id: s.id }, data: { commissionRatePct: parseRate(data.get(`staff_${s.id}`)) } })),
      ...serviceRows.map(s => db.service.update({ where: { id: s.id }, data: { commissionRatePct: parseRate(data.get(`service_${s.id}`)) } })),
    ])
    await recordAudit({ action: 'commission.config', entityType: 'Commission', summary: `Updated commission rates (default ${parseRate(data.get('default')) ?? 0}%)` })
    revalidatePath('/hr/commission')
  }

  const seg = SEGMENTS.boarding

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs cd-muted">Human Resource</span><span className="text-xs cd-muted">›</span><span className="text-xs cd-muted">Commission</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Commission
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/hr/commission?month=${shift(month, -1)}`} className="cd-btn-sec text-sm">←</Link>
          <span className="text-sm font-medium" style={{ color: '#2D1907', minWidth: '9rem', textAlign: 'center' }}>{monthLabel(month)}</span>
          <Link href={`/hr/commission?month=${shift(month, 1)}`} className="cd-btn-sec text-sm">→</Link>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Commissionable revenue" value={rm(report.totalRevenue)} />
        <Stat label="Commission earned" value={rm(report.totalCommission)} accent />
        <Stat label="Services" value={String(report.appts.length)} />
      </div>

      {/* Per-groomer */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>By groomer</h2>
        <div className="cd-card overflow-hidden">
          {report.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm cd-muted text-center">No completed grooming services in {monthLabel(month)}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="cd-thead"><th>Groomer</th><th>Services</th><th>Revenue</th><th>Commission</th></tr></thead>
              <tbody className="cd-tbody">
                {report.rows.map(r => (
                  <tr key={r.staffId}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>{r.staffName}</td>
                    <td className="px-4 py-2.5 cd-muted">{r.count}</td>
                    <td className="px-4 py-2.5 cd-muted">{rm(r.revenue)}</td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: '#B14919' }}>{rm(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Detail */}
      {report.appts.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Detail</h2>
          <div className="cd-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead"><th>Date</th><th>Groomer</th><th>Service</th><th>Revenue</th><th>Rate</th><th>Commission</th></tr></thead>
              <tbody className="cd-tbody">
                {report.appts.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 cd-muted whitespace-nowrap">{a.date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}</td>
                    <td className="px-4 py-2" style={{ color: '#2D1907' }}>{a.staffName}</td>
                    <td className="px-4 py-2 cd-muted">{a.serviceName}</td>
                    <td className="px-4 py-2 cd-muted">{rm(a.revenue)}</td>
                    <td className="px-4 py-2 cd-muted">{a.ratePct}%</td>
                    <td className="px-4 py-2" style={{ color: '#B14919' }}>{rm(a.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Config */}
      <section>
        <h2 className="font-semibold mb-1" style={{ color: '#2D1907' }}>Commission rates</h2>
        <p className="text-xs cd-muted mb-3">Rate precedence: a groomer&apos;s own rate wins, then the service&apos;s rate, then the default. Leave a field blank to fall back.</p>
        <form action={saveConfig} className="cd-card p-4 space-y-4">
          <div>
            <label className="cd-label">Default rate (%)</label>
            <input name="default" type="number" step="0.5" min="0" className="cd-input" style={{ width: '8rem' }} defaultValue={report.defaultPct || ''} placeholder="e.g. 10" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="cd-label mb-1">Per-groomer overrides</div>
              <div className="space-y-1.5">
                {staff.map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate" style={{ color: '#2D1907' }}>{s.name} <span className="cd-muted text-xs">· {s.role}</span></span>
                    <input name={`staff_${s.id}`} type="number" step="0.5" min="0" className="cd-input" style={{ width: '5rem' }} defaultValue={s.commissionRatePct ?? ''} placeholder="%" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="cd-label mb-1">Per-service overrides</div>
              <div className="space-y-1.5">
                {services.length === 0 && <p className="text-xs cd-muted">No grooming services yet.</p>}
                {services.map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate" style={{ color: '#2D1907' }}>{s.name} <span className="cd-muted text-xs">· {rm(s.price)}</span></span>
                    <input name={`service_${s.id}`} type="number" step="0.5" min="0" className="cd-input" style={{ width: '5rem' }} defaultValue={s.commissionRatePct ?? ''} placeholder="%" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Save rates</SubmitButton>
          </div>
        </form>
      </section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold" style={{ color: accent ? '#B14919' : '#2D1907' }}>{value}</div>
    </div>
  )
}
