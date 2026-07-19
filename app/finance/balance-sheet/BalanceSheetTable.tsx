'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BalanceSheet, BSLine, BSSection } from '@/lib/balance-sheet'
import { saveBalanceSheetCells } from './actions'

const INK = '#2D1907'
const BLUE = '#1D4ED8'
const RED = '#B14919'
const OLIVE = '#5c6b3c'
const SEG = '#5C4A32'

const fmt = (v: number) =>
  v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
    : v === 0 ? '–'
    : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

export function BalanceSheetTable({ sheet }: { sheet: BalanceSheet }) {
  const router = useRouter()
  const [editMode, setEditMode] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Effective value of a line: auto lines are fixed; keyed lines use the draft
  const val = (l: BSLine): number => {
    if (l.auto) return l.value
    const d = drafts[l.key]
    if (d === undefined) return l.value
    const n = parseFloat(d)
    return d.trim() === '' ? 0 : Number.isFinite(n) ? n : l.value
  }
  const secTotal = (s: BSSection) => s.lines.reduce((a, l) => a + val(l), 0)
  const blockTotal = (secs: BSSection[]) => secs.reduce((a, s) => a + secTotal(s), 0)

  // Live totals recompute as the accountant types
  const totals = useMemo(() => {
    const A = blockTotal(sheet.assets)
    const L = blockTotal(sheet.liabilities)
    const E = blockTotal(sheet.equity)
    return { A, L, E, check: Math.round((A - (L + E)) * 100) / 100 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, sheet])
  const balanced = Math.abs(totals.check) < 0.5

  function beginEdit() { setDrafts({}); setError(null); setEditMode(true) }
  function cancel() { setDrafts({}); setError(null); setEditMode(false) }

  async function save() {
    const cells: { lineKey: string; amount: number | null }[] = []
    for (const [key, d] of Object.entries(drafts)) {
      const trimmed = d.trim()
      if (trimmed === '') { cells.push({ lineKey: key, amount: null }); continue }
      const n = parseFloat(trimmed)
      if (!Number.isFinite(n)) { setError(`"${trimmed}" is not a valid amount.`); return }
      cells.push({ lineKey: key, amount: n })
    }
    if (cells.length === 0) { cancel(); return }
    setBusy(true)
    const res = await saveBalanceSheetCells(JSON.stringify({ asOf: sheet.asOf, cells }))
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setDrafts({}); setEditMode(false); router.refresh()
  }

  const lineRow = (l: BSLine) => {
    const keyed = !l.auto
    const editing = editMode && keyed
    return (
      <tr key={l.key}>
        <td className="px-4 py-1.5 pl-7 whitespace-nowrap" style={{ color: INK }}>
          {l.label}
          {editMode && keyed && l.hint && <span className="ml-2 text-xs" style={{ color: 'rgba(45,25,7,0.45)' }}>· {l.hint}</span>}
        </td>
        <td className="px-4 py-1.5 text-right" style={{ minWidth: '9rem' }}>
          {editing ? (
            <input type="number" step="0.01" autoFocus={false}
              value={drafts[l.key] ?? (l.value === 0 ? '' : String(l.value))}
              placeholder="0"
              onChange={e => setDrafts(p => ({ ...p, [l.key]: e.target.value }))}
              className="w-32 text-right text-xs rounded px-1.5 py-1"
              style={{ border: `1px solid ${BLUE}`, color: BLUE, background: '#fff', outline: 'none' }} />
          ) : (
            <span className="tabular-nums" style={{ color: val(l) < 0 ? RED : keyed ? BLUE : 'rgba(45,25,7,0.8)', fontWeight: keyed ? 600 : 400 }}>
              {fmt(val(l))}
            </span>
          )}
        </td>
      </tr>
    )
  }

  const subtotalRow = (s: BSSection) => (
    <tr style={{ borderTop: '1px solid rgba(45,25,7,0.12)' }}>
      <td className="px-4 py-1 pl-7 text-xs uppercase tracking-wide" style={{ color: 'rgba(45,25,7,0.5)' }}>{s.title} subtotal</td>
      <td className="px-4 py-1 text-right tabular-nums text-xs" style={{ color: 'rgba(45,25,7,0.6)' }}>{fmt(secTotal(s))}</td>
    </tr>
  )

  const sectionHead = (label: string) => (
    <tr><td colSpan={2} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase" style={{ color: SEG, letterSpacing: '0.08em' }}>{label}</td></tr>
  )
  const totalRow = (label: string, v: number) => (
    <tr style={{ borderTop: '2px solid rgba(45,25,7,0.25)' }}>
      <td className="px-4 py-1.5 font-bold" style={{ color: INK }}>{label}</td>
      <td className="px-4 py-1.5 text-right font-bold tabular-nums" style={{ color: v < 0 ? RED : INK }}>{fmt(v)}</td>
    </tr>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs cd-muted">
          <span><span className="font-semibold" style={{ color: INK }}>Black</span> — derived live from the OS.</span>
          <span><span className="font-semibold" style={{ color: BLUE }}>Blue</span> — keyed by the accountant (cash, inventory, assets, loans, capital).</span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <button onClick={save} disabled={busy} className="cd-btn text-sm">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={cancel} disabled={busy} className="cd-btn-sec text-sm">Cancel</button>
            </>
          ) : (
            <button onClick={beginEdit} className="cd-btn-sec text-sm">✎ Edit</button>
          )}
        </div>
      </div>

      {/* Balance check banner */}
      <div className="rounded-xl px-4 py-2.5 text-sm flex items-center justify-between"
        style={balanced
          ? { background: 'rgba(122,138,79,0.15)', border: '1px solid rgba(122,138,79,0.35)', color: OLIVE }
          : { background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.3)', color: RED }}>
        <span className="font-semibold">
          {balanced ? '✓ Balanced — Assets = Liabilities + Equity' : `⚠ Out of balance by RM ${Math.abs(totals.check).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`}
        </span>
        <span className="text-xs">
          Assets {fmt(totals.A)} · Liabilities + Equity {fmt(totals.L + totals.E)}
          {!balanced && ' — key the missing figure (often opening cash, capital or a loan).'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="cd-card overflow-hidden">
          <table className="text-sm w-full" style={{ borderCollapse: 'collapse' }}>
            <tbody className="cd-tbody">
              {sectionHead('Assets')}
              {sheet.assets.map(s => <FragmentSection key={s.title} s={s} lineRow={lineRow} subtotalRow={subtotalRow} />)}
              {totalRow('Total Assets', totals.A)}
            </tbody>
          </table>
        </div>
        <div className="cd-card overflow-hidden">
          <table className="text-sm w-full" style={{ borderCollapse: 'collapse' }}>
            <tbody className="cd-tbody">
              {sectionHead('Liabilities')}
              {sheet.liabilities.map(s => <FragmentSection key={s.title} s={s} lineRow={lineRow} subtotalRow={subtotalRow} />)}
              {totalRow('Total Liabilities', totals.L)}
              {sectionHead('Equity')}
              {sheet.equity.map(s => <FragmentSection key={s.title} s={s} lineRow={lineRow} subtotalRow={subtotalRow} />)}
              {totalRow('Total Equity', totals.E)}
              {totalRow('Liabilities + Equity', totals.L + totals.E)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function FragmentSection({ s, lineRow, subtotalRow }: {
  s: BSSection
  lineRow: (l: BSLine) => React.ReactNode
  subtotalRow: (s: BSSection) => React.ReactNode
}) {
  return (
    <>
      <tr><td colSpan={2} className="px-4 pt-2 pb-0.5 text-xs font-medium" style={{ color: 'rgba(45,25,7,0.55)' }}>{s.title}</td></tr>
      {s.lines.map(lineRow)}
      {subtotalRow(s)}
    </>
  )
}
