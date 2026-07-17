import type { MonthlyRevenuePoint, DailyBookingPoint } from '@/lib/charts'

const STREAM_COLORS: Record<string, string> = {
  Grooming: '#B14919', Boarding: '#729094', Retail: '#9c6b3f',
  Membership: '#B8902B', Academy: '#2D1907', Other: '#a89878',
}
const INK = '#2D1907'
const GRID = 'rgba(45,25,7,0.10)'
const MUTED = 'rgba(45,25,7,0.45)'

const rm = (n: number) => `RM ${Math.round(n).toLocaleString()}`
// Round a max up to a clean axis ceiling (e.g. 4300 -> 5000)
function niceCeil(v: number) {
  if (v <= 0) return 100
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

/* ───────────────────────── Monthly revenue — line + area ───────────────────────── */
export function RevenueLineChart({ data }: { data: MonthlyRevenuePoint[] }) {
  const W = 760, H = 260
  const padL = 52, padR = 14, padT = 16, padB = 30
  const plotW = W - padL - padR, plotH = H - padT - padB
  const max = niceCeil(Math.max(...data.map(d => d.total), 0))
  const x = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const y = (v: number) => padT + plotH - (v / max) * plotH

  const linePts = data.map((d, i) => `${x(i)},${y(d.total)}`).join(' ')
  const areaPts = `${padL},${padT + plotH} ${linePts} ${padL + plotW},${padT + plotH}`
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const hasData = data.some(d => d.total > 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly revenue, last 12 months"
      style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B14919" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#B14919" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines + y labels */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={padL + plotW} y2={y(v)} stroke={GRID} strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
            {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
          </text>
        </g>
      ))}

      {hasData && <polygon points={areaPts} fill="url(#revFill)" />}
      {hasData && <polyline points={linePts} fill="none" stroke="#B14919" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}

      {/* dots + native hover tooltips */}
      {data.map((d, i) => (
        <g key={d.key}>
          {hasData && (
            <circle cx={x(i)} cy={y(d.total)} r={3.5} fill="#fff" stroke="#B14919" strokeWidth={2}>
              <title>{`${d.label} — ${rm(d.total)}`}</title>
            </circle>
          )}
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={MUTED}>{d.label}</text>
        </g>
      ))}

      {!hasData && (
        <text x={W / 2} y={padT + plotH / 2} textAnchor="middle" fontSize={12} fill={MUTED}>
          No revenue recorded yet — sales will chart here.
        </text>
      )}
    </svg>
  )
}

/* ───────────────────────── This-month revenue mix — donut ───────────────────────── */
export function RevenueMixDonut({ mix }: { mix: { cat: string; value: number }[] }) {
  const total = mix.reduce((s, m) => s + m.value, 0)
  const R = 62, C = 74, stroke = 22
  const circ = 2 * Math.PI * R

  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm" style={{ color: MUTED }}>
        No revenue this month yet
      </div>
    )
  }

  let offset = 0
  const arcs = mix.map(m => {
    const frac = m.value / total
    const arc = { ...m, frac, dash: frac * circ, off: offset }
    offset += frac * circ
    return arc
  })

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg viewBox="0 0 148 148" width={148} height={148} style={{ flexShrink: 0 }} role="img" aria-label="Revenue mix this month">
        <g transform="rotate(-90 74 74)">
          {arcs.map(a => (
            <circle key={a.cat} cx={C} cy={C} r={R} fill="none"
              stroke={STREAM_COLORS[a.cat] ?? MUTED} strokeWidth={stroke}
              strokeDasharray={`${a.dash} ${circ - a.dash}`} strokeDashoffset={-a.off}>
              <title>{`${a.cat} — ${rm(a.value)} (${Math.round(a.frac * 100)}%)`}</title>
            </circle>
          ))}
        </g>
        <text x={74} y={70} textAnchor="middle" fontSize={13} fontWeight="700" fill={INK}>{rm(total)}</text>
        <text x={74} y={86} textAnchor="middle" fontSize={9} fill={MUTED}>this month</text>
      </svg>
      <ul className="space-y-1.5 text-sm flex-1 min-w-[140px]">
        {arcs.map(a => (
          <li key={a.cat} className="flex items-center gap-2">
            <span className="rounded-sm" style={{ width: 10, height: 10, background: STREAM_COLORS[a.cat] ?? MUTED }} />
            <span style={{ color: INK }}>{a.cat}</span>
            <span className="ml-auto tabular-nums" style={{ color: MUTED }}>
              {rm(a.value)} · {Math.round(a.frac * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────────────────────── Daily bookings — stacked bars ───────────────────────── */
export function BookingsBarChart({ data }: { data: DailyBookingPoint[] }) {
  const W = 760, H = 220
  const padL = 28, padR = 12, padT = 12, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const max = Math.max(...data.map(d => d.total), 1)
  const niceMax = niceCeil(max)
  const slot = plotW / data.length
  const barW = Math.min(slot * 0.62, 20)
  const hSeg = (n: number) => (n / niceMax) * plotH
  const segs: [keyof DailyBookingPoint, string][] = [['grooming', '#B14919'], ['boarding', '#729094'], ['other', '#a89878']]
  const hasData = data.some(d => d.total > 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bookings per day, last 30 days"
      style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={padL} y1={padT + plotH - f * plotH} x2={padL + plotW} y2={padT + plotH - f * plotH} stroke={GRID} strokeWidth={1} />
          <text x={padL - 6} y={padT + plotH - f * plotH + 3} textAnchor="end" fontSize={9} fill={MUTED}>{Math.round(f * niceMax)}</text>
        </g>
      ))}

      {data.map((d, i) => {
        const cx = padL + i * slot + slot / 2
        let yTop = padT + plotH
        return (
          <g key={d.key}>
            {segs.map(([field, color]) => {
              const n = d[field] as number
              if (n <= 0) return null
              const h = hSeg(n)
              yTop -= h
              return <rect key={field} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={color} rx={1} />
            })}
            {/* invisible full-height hit area for a single combined tooltip */}
            <rect x={cx - slot / 2} y={padT} width={slot} height={plotH} fill="transparent">
              <title>{`${d.label} — ${d.total} booking${d.total === 1 ? '' : 's'}${d.total > 0 ? ` (${d.grooming} grooming · ${d.boarding} boarding${d.other ? ` · ${d.other} other` : ''})` : ''}`}</title>
            </rect>
            {i % 5 === 0 && <text x={cx} y={H - 9} textAnchor="middle" fontSize={9} fill={MUTED}>{d.label}</text>}
          </g>
        )
      })}

      {!hasData && (
        <text x={W / 2} y={padT + plotH / 2} textAnchor="middle" fontSize={12} fill={MUTED}>
          No bookings in the last 30 days yet.
        </text>
      )}
    </svg>
  )
}

export function ChartLegend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
          <span className="rounded-sm" style={{ width: 9, height: 9, background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}
