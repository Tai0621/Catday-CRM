import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { monthKey, monthLabel, monthsBetween, projectedBreakeven } from '@/lib/plan'

export default async function PlanPage() {
  await requireAuth()

  const plan = await db.businessPlan.findUnique({ where: { id: 'default' } })
  const targets = await db.monthlyTarget.findMany({ orderBy: { month: 'asc' } })
  const targetMap = Object.fromEntries(targets.map(t => [t.month, t]))

  const now = new Date()
  const defaultStart = monthKey(now)
  const defaultBreakeven = monthKey(new Date(now.getFullYear() + 3, now.getMonth(), 1))

  // ── Save plan settings + generate the month rows ───────────────────────────
  async function savePlan(data: FormData) {
    'use server'
    const startMonth = data.get('startMonth') as string
    const breakevenMonth = data.get('breakevenMonth') as string
    const avgSaleValue = parseFloat((data.get('avgSaleValue') as string) || '0')

    await db.businessPlan.upsert({
      where: { id: 'default' },
      create: { id: 'default', startMonth, breakevenMonth, avgSaleValue },
      update: { startMonth, breakevenMonth, avgSaleValue },
    })

    // Create any missing monthly rows across the plan horizon.
    const months = monthsBetween(startMonth, breakevenMonth)
    const existing = new Set((await db.monthlyTarget.findMany({ select: { month: true } })).map(m => m.month))
    for (const month of months) {
      if (!existing.has(month)) {
        await db.monthlyTarget.create({ data: { month } })
      }
    }
    revalidatePath('/plan')
  }

  // ── Save all monthly revenue/cost figures ──────────────────────────────────
  async function saveTargets(data: FormData) {
    'use server'
    const rows = await db.monthlyTarget.findMany({ select: { id: true, month: true } })
    for (const row of rows) {
      const rev = parseFloat((data.get(`rev_${row.month}`) as string) || '0')
      const cost = parseFloat((data.get(`cost_${row.month}`) as string) || '0')
      await db.monthlyTarget.update({
        where: { id: row.id },
        data: { revenueTarget: isNaN(rev) ? 0 : rev, costBudget: isNaN(cost) ? 0 : cost },
      })
    }
    revalidatePath('/plan')
  }

  const totalRevenue = targets.reduce((s, t) => s + t.revenueTarget, 0)
  const totalCost = targets.reduce((s, t) => s + t.costBudget, 0)
  const breakeven = projectedBreakeven(targets)
  const avgSale = plan?.avgSaleValue ?? 0

  // cumulative net for the running view
  let cum = 0
  const cumByMonth: Record<string, number> = {}
  for (const t of targets) { cum += t.revenueTarget - t.costBudget; cumByMonth[t.month] = cum }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Financial Plan</h1>
        <p className="text-sm cd-muted">
          Set the 3-year breakeven plan. The dashboard uses it to tell the CEO how many sales to close each week.
        </p>
      </div>

      {/* Plan settings */}
      <form action={savePlan} className="cd-card p-5">
        <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>Plan Settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="cd-label">Plan Start (month)</label>
            <input name="startMonth" type="month" required defaultValue={plan?.startMonth ?? defaultStart} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Target Breakeven (month)</label>
            <input name="breakevenMonth" type="month" required defaultValue={plan?.breakevenMonth ?? defaultBreakeven} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Avg Sale Value (RM)</label>
            <input name="avgSaleValue" type="number" step="0.01" min="0" defaultValue={plan?.avgSaleValue ?? ''} placeholder="e.g. 250" className="cd-input" />
          </div>
        </div>
        <p className="text-xs cd-muted mt-2">
          Avg sale value converts a revenue target into a number of sales. Saving also generates a row for every month in the plan.
        </p>
        <button type="submit" className="cd-btn mt-4">Save & Generate Months</button>
      </form>

      {targets.length === 0 ? (
        <div className="cd-card py-12 text-center cd-muted">
          No plan months yet — set your start &amp; breakeven months above and save to generate the template.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Planned Revenue" value={`RM ${totalRevenue.toLocaleString()}`} />
            <SummaryCard label="Planned Cost" value={`RM ${totalCost.toLocaleString()}`} />
            <SummaryCard label="Net (plan)" value={`RM ${(totalRevenue - totalCost).toLocaleString()}`}
              accent={totalRevenue - totalCost >= 0 ? '#729094' : '#B14919'} />
            <SummaryCard label="Projected Breakeven" value={breakeven ? monthLabel(breakeven) : 'Not yet'}
              accent={breakeven ? '#2D1907' : '#B14919'} />
          </div>

          {/* Editable monthly table */}
          <form action={saveTargets} className="cd-card overflow-hidden">
            <div className="cd-section-header">
              <h2 className="font-semibold" style={{ color: '#2D1907' }}>Monthly Targets</h2>
              <button type="submit" className="cd-btn text-xs" style={{ padding: '0.35rem 0.75rem' }}>Save Targets</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="cd-thead">
                  <th>Month</th>
                  <th>Revenue Target (RM)</th>
                  <th>Cost Budget (RM)</th>
                  <th>Monthly P/L</th>
                  <th>Sales Needed</th>
                  <th>Cumulative Net</th>
                </tr></thead>
                <tbody className="cd-tbody">
                  {targets.map(t => {
                    const pl = t.revenueTarget - t.costBudget
                    const salesNeeded = avgSale > 0 ? Math.ceil(t.revenueTarget / avgSale) : null
                    const cumNet = cumByMonth[t.month]
                    const isCurrent = t.month === monthKey(now)
                    return (
                      <tr key={t.id} style={isCurrent ? { background: 'rgba(231,206,122,0.25)' } : undefined}>
                        <td className="px-4 py-2 font-medium" style={{ color: '#2D1907' }}>
                          {monthLabel(t.month)}{isCurrent && <span className="cd-muted font-normal"> · now</span>}
                        </td>
                        <td className="px-4 py-2">
                          <input name={`rev_${t.month}`} type="number" step="0.01" min="0" defaultValue={t.revenueTarget || ''} placeholder="0"
                            className="cd-input" style={{ width: '7rem', padding: '0.3rem 0.5rem' }} />
                        </td>
                        <td className="px-4 py-2">
                          <input name={`cost_${t.month}`} type="number" step="0.01" min="0" defaultValue={t.costBudget || ''} placeholder="0"
                            className="cd-input" style={{ width: '7rem', padding: '0.3rem 0.5rem' }} />
                        </td>
                        <td className="px-4 py-2 font-medium" style={{ color: pl >= 0 ? '#729094' : '#B14919' }}>
                          {pl >= 0 ? '+' : ''}{pl.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 cd-muted">{salesNeeded != null ? salesNeeded : '—'}</td>
                        <td className="px-4 py-2 font-medium" style={{ color: cumNet >= 0 ? '#729094' : 'rgba(45,25,7,0.55)' }}>
                          {cumNet >= 0 ? '+' : ''}{cumNet.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </form>
          <p className="text-xs cd-muted">
            “Sales Needed” = monthly revenue target ÷ avg sale value. “Cumulative Net” turning positive marks your breakeven point.
          </p>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold" style={{ color: accent ?? '#2D1907' }}>{value}</div>
    </div>
  )
}
