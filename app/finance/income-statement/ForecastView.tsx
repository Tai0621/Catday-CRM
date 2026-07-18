import { FIVE_YEAR, FIVE_YEAR_PCTS, FORECAST_YEARS, YEAR1_MONTHLY, YEAR1_UTILIZATION, rowTotal, type ForecastRow } from '@/lib/finance-forecast'
import { MONTH_LABELS } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'

// The estimated income statement from the owner's Excel model, rendered as two
// tables: the 5-year annual forecast and the Year-1 monthly ramp-up build.
export function ForecastView() {
  const seg = SEGMENTS.business

  const fmt = (v: number) =>
    v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
      : v === 0 ? '–'
      : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

  const cell = (v: number, bold?: boolean, key?: number) => (
    <td key={key} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
      style={{ color: v < 0 ? '#B14919' : bold ? '#2D1907' : 'rgba(45,25,7,0.75)', fontWeight: bold ? 700 : 400 }}>
      {fmt(v)}
    </td>
  )

  const labelTd = (r: ForecastRow) => (
    <td className={`px-3 py-1.5 whitespace-nowrap ${r.indent ? 'pl-7' : ''} ${r.label.startsWith('Cumulative') ? 'text-xs italic' : ''}`}
      style={{
        color: r.label.startsWith('Cumulative') ? 'rgba(45,25,7,0.5)' : '#2D1907',
        fontWeight: r.bold ? 700 : 400,
        position: 'sticky', left: 0, background: '#F2EDE0',
      }}>
      {r.label}
    </td>
  )

  const sectionHead = (label: string, span: number) => (
    <tr>
      <td colSpan={span} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase"
        style={{ color: seg.text, letterSpacing: '0.08em', position: 'sticky', left: 0 }}>
        {label}
      </td>
    </tr>
  )

  return (
    <>
      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(231,206,122,0.28)', border: '1px solid rgba(231,206,122,0.55)', color: '#2D1907' }}>
        <strong>Estimates, not actuals</strong> — the conservative scenario from your Excel model
        (utilization ramping 5% → 35% in Year 1 · RM88/night boarding · RM128/session grooming · 24% tax).
        Switch to <strong>Actuals</strong> to see the live figures from checkout.
      </div>

      {/* ── 5-year annual forecast ── */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>
          5-Year Forecast <span className="cd-muted font-normal">· annual, RM</span>
        </h2>
        <div className="cd-card overflow-x-auto">
          <table className="text-xs w-full" style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
            <thead>
              <tr className="cd-thead">
                <th style={{ position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>RM</th>
                {FORECAST_YEARS.map(y => <th key={y} className="text-right px-2">{y}</th>)}
              </tr>
            </thead>
            <tbody className="cd-tbody">
              {FIVE_YEAR.map((grp, gi) => (
                <FragmentRows key={gi} grp={grp} span={FORECAST_YEARS.length + 1} sectionHead={sectionHead} labelTd={labelTd} cell={cell} />
              ))}
              {FIVE_YEAR_PCTS.map(p => (
                <tr key={p.label}>
                  <td className="px-3 py-1 text-xs italic whitespace-nowrap"
                    style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>{p.label}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="px-2 py-1 text-right text-xs italic tabular-nums"
                      style={{ color: v.startsWith('-') ? '#B14919' : 'rgba(45,25,7,0.55)' }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Year 1 monthly ramp ── */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>
          Year 1 Monthly Ramp-Up <span className="cd-muted font-normal">· 2026, RM</span>
        </h2>
        <div className="cd-card overflow-x-auto">
          <table className="text-xs w-full" style={{ borderCollapse: 'collapse', minWidth: '68rem' }}>
            <thead>
              <tr className="cd-thead">
                <th style={{ position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>RM</th>
                {MONTH_LABELS.map(m => <th key={m} className="text-right px-2">{m}</th>)}
                <th className="text-right px-2" style={{ borderLeft: '1px solid rgba(45,25,7,0.15)' }}>Year 1</th>
              </tr>
            </thead>
            <tbody className="cd-tbody">
              <tr>
                <td className="px-3 py-1 text-xs italic whitespace-nowrap"
                  style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>Utilization %</td>
                {YEAR1_UTILIZATION.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-right text-xs italic tabular-nums" style={{ color: 'rgba(45,25,7,0.55)' }}>{v}</td>
                ))}
                <td className="px-2 py-1 text-right text-xs italic tabular-nums"
                  style={{ color: 'rgba(45,25,7,0.55)', borderLeft: '1px solid rgba(45,25,7,0.15)' }}>20.0%</td>
              </tr>
              {YEAR1_MONTHLY.map((grp, gi) => (
                <FragmentRows key={gi} grp={grp} span={14} sectionHead={sectionHead} labelTd={labelTd} cell={cell} withTotal />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs cd-muted">
        Source: CATDAY Income Statement.xlsx (conservative scenario). Edit lib/finance-forecast.ts if the model changes.
      </p>
    </>
  )
}

function FragmentRows({ grp, span, sectionHead, labelTd, cell, withTotal }: {
  grp: { section: string | null; rows: ForecastRow[] }
  span: number
  sectionHead: (label: string, span: number) => React.ReactNode
  labelTd: (r: ForecastRow) => React.ReactNode
  cell: (v: number, bold?: boolean, key?: number) => React.ReactNode
  withTotal?: boolean
}) {
  return (
    <>
      {grp.section && sectionHead(grp.section, span)}
      {grp.rows.map(r => {
        // A cumulative line's "total" is its final value, not a re-sum
        const total = r.label.startsWith('Cumulative') ? r.values[r.values.length - 1] : rowTotal(r)
        return (
          <tr key={r.label} style={r.topRule ? { borderTop: '2px solid rgba(45,25,7,0.25)' } : undefined}>
            {labelTd(r)}
            {r.values.map((v, i) => cell(v, r.bold, i))}
            {withTotal && (
              <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
                style={{ color: total < 0 ? '#B14919' : '#2D1907', fontWeight: 700, borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
                {total < 0 ? `(${Math.abs(total).toLocaleString('en-MY', { maximumFractionDigits: 0 })})` : total.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
              </td>
            )}
          </tr>
        )
      })}
    </>
  )
}
