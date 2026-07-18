'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IncomeStatement, StatementRow } from '@/lib/finance'
import { saveStatementCells, addStatementRow, removeStatementRow, hideStatementRow, unhideStatementRow } from './actions'

// Excel-style workpaper. BLACK figures flow live from the OS (checkout,
// expenses); BLUE figures are hard-keyed by the accountant. Editing follows
// the Edit → change → Save cycle; custom rows can be added and deleted.
const INK = '#2D1907'
const BLUE = '#1D4ED8'
const RED = '#B14919'
const SEG_TEXT = '#5C4A32'

const fmt = (v: number) =>
  v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
    : v === 0 ? '–'
    : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

const cellKey = (rowKey: string, m: number) => `${rowKey}|${m}`

export function StatementTable({ statement: s, mode = 'actuals' }: {
  statement: IncomeStatement
  mode?: 'actuals' | 'forecast'
}) {
  const forecast = mode === 'forecast'
  const router = useRouter()
  const [editMode, setEditMode] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null) // section being added to
  const [newLabel, setNewLabel] = useState('')

  // What each editable cell "starts as": the keyed figure, or '' when it's the live OS value
  const initial = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of [...s.revenue, ...s.cogs, ...s.opex, s.tax]) {
      if (!r.key) continue
      r.values.forEach((v, m) => { map[cellKey(r.key!, m)] = r.overridden?.[m] ? String(v) : '' })
    }
    return map
  }, [s])

  function beginEdit() {
    setDrafts({})
    setError(null)
    setEditMode(true)
  }

  function cancelEdit() {
    setDrafts({})
    setAddingTo(null)
    setError(null)
    setEditMode(false)
  }

  async function save() {
    const cells: { month: number; rowKey: string; amount: number | null }[] = []
    for (const [k, draft] of Object.entries(drafts)) {
      if (draft === initial[k]) continue // untouched
      const [rowKey, mStr] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)]
      const trimmed = draft.trim()
      if (trimmed === '') {
        cells.push({ month: Number(mStr), rowKey, amount: null }) // cleared → back to OS
        continue
      }
      const amount = parseFloat(trimmed)
      if (!(Number.isFinite(amount) && amount >= 0)) {
        setError(`"${trimmed}" is not a valid amount.`)
        return
      }
      cells.push({ month: Number(mStr), rowKey, amount })
    }
    if (cells.length === 0) { cancelEdit(); return }
    setBusy(true)
    const res = await saveStatementCells(JSON.stringify({ year: s.year, cells }))
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setDrafts({})
    setEditMode(false)
    router.refresh()
  }

  async function addRow(section: string) {
    const label = newLabel.trim()
    if (!label) return
    setBusy(true)
    const res = await addStatementRow(JSON.stringify({ year: s.year, section, label }))
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setNewLabel('')
    setAddingTo(null)
    router.refresh()
  }

  async function deleteRow(r: StatementRow) {
    if (!r.key || r.key === 'tax') return
    setBusy(true)
    let res
    if (r.custom && r.key.startsWith('custom:')) {
      if (!window.confirm(`Delete the row “${r.label}” and all figures keyed into it?`)) { setBusy(false); return }
      res = await removeStatementRow(JSON.stringify({ id: r.key.slice('custom:'.length) }))
    } else {
      // Built-in row: hide it for this year — OS data stays and it can be restored
      const os = r.autoValues?.reduce((a, v) => a + v, 0) ?? 0
      const warn = os > 0
        ? `Remove “${r.label}” from the ${s.year} statement?\n\nIts live OS figures (RM ${os.toLocaleString('en-MY')} this year) will be excluded from every total until you restore it.`
        : `Remove “${r.label}” from the ${s.year} statement? You can restore it any time.`
      if (!window.confirm(warn)) { setBusy(false); return }
      res = await hideStatementRow(JSON.stringify({ year: s.year, rowKey: r.key }))
    }
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    router.refresh()
  }

  async function restoreRow(rowKey: string) {
    setBusy(true)
    const res = await unhideStatementRow(JSON.stringify({ year: s.year, rowKey }))
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    router.refresh()
  }

  // ── cells ──
  const editCell = (r: StatementRow, m: number) => {
    const k = cellKey(r.key!, m)
    const value = drafts[k] ?? initial[k]
    return (
      <td key={m} className="px-1 py-1 text-right" style={{ minWidth: '4.6rem' }}>
        <input
          type="number" min="0" step="0.01"
          value={value}
          placeholder={fmt(r.autoValues?.[m] ?? 0)}
          onChange={e => setDrafts(prev => ({ ...prev, [k]: e.target.value }))}
          className="w-full text-right text-xs rounded px-1 py-0.5"
          style={{
            border: `1px solid ${value !== '' ? BLUE : 'rgba(45,25,7,0.2)'}`,
            color: BLUE, background: '#fff', outline: 'none',
          }}
        />
      </td>
    )
  }

  const viewCell = (r: StatementRow, m: number) => {
    const manual = !forecast && (r.overridden?.[m] ?? false)
    return (
      <td key={m} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
        title={forecast ? undefined : manual
          ? `Hard-keyed — OS figure is RM ${(r.autoValues?.[m] ?? 0).toLocaleString('en-MY')}.`
          : 'Live from the OS.'}
        style={{ color: manual ? BLUE : 'rgba(45,25,7,0.75)', fontWeight: manual ? 600 : 400 }}>
        {fmt(r.values[m])}
      </td>
    )
  }

  const readCell = (v: number, bold = false, key?: number) => (
    <td key={key} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
      style={{ color: v < 0 ? RED : bold ? INK : 'rgba(45,25,7,0.75)', fontWeight: bold ? 700 : 400 }}>
      {fmt(v)}
    </td>
  )

  const totalTd = (r: StatementRow) => (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
      style={{
        color: r.total < 0 ? RED : r.overridden?.some(Boolean) ? BLUE : INK,
        fontWeight: 700, borderLeft: '1px solid rgba(45,25,7,0.15)',
      }}>
      {fmt(r.total)}
    </td>
  )

  const labelTd = (r: StatementRow, opts?: { bold?: boolean; indent?: boolean }) => (
    <td className={`px-3 py-1.5 whitespace-nowrap ${opts?.indent ? 'pl-7' : ''}`}
      style={{ color: INK, fontWeight: opts?.bold ? 700 : 400, position: 'sticky', left: 0, background: '#F2EDE0' }}>
      <span className="inline-flex items-center gap-1.5">
        {editMode && r.key && r.key !== 'tax' && (
          <button onClick={() => deleteRow(r)} disabled={busy}
            title={r.custom ? `Delete “${r.label}” and its figures` : `Remove “${r.label}” from this year (restorable — OS data stays)`}
            className="text-[10px] leading-none rounded px-1.5 py-0.5 font-semibold whitespace-nowrap"
            style={{ color: '#fff', background: RED }}>
            ✕ delete
          </button>
        )}
        {r.label}
        {r.custom && !editMode && <span className="text-[10px]" style={{ color: BLUE, opacity: 0.7 }}>manual</span>}
      </span>
    </td>
  )

  const leafRow = (r: StatementRow) => (
    <tr key={r.key ?? r.label}>
      {labelTd(r, { indent: true })}
      {r.values.map((_, m) => (editMode ? editCell(r, m) : viewCell(r, m)))}
      {totalTd(r)}
    </tr>
  )

  const derivedRow = (r: StatementRow, opts?: { bold?: boolean; topRule?: boolean }) => (
    <tr key={r.label} style={opts?.topRule ? { borderTop: '2px solid rgba(45,25,7,0.25)' } : undefined}>
      {labelTd(r, { bold: opts?.bold })}
      {r.values.map((v, m) => readCell(v, opts?.bold, m))}
      {totalTd(r)}
    </tr>
  )

  const sectionHead = (label: string) => (
    <tr>
      <td colSpan={14} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase"
        style={{ color: SEG_TEXT, letterSpacing: '0.08em', position: 'sticky', left: 0 }}>
        {label}
      </td>
    </tr>
  )

  // "+ Add row" line at the foot of a section (edit mode only)
  const addRowLine = (section: string, prompt: string) => {
    if (!editMode) return null
    return (
      <tr key={`add-${section}`}>
        <td colSpan={14} className="px-3 py-1.5" style={{ position: 'sticky', left: 0 }}>
          {addingTo === section ? (
            <span className="inline-flex items-center gap-2">
              <input autoFocus value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addRow(section); if (e.key === 'Escape') { setAddingTo(null); setNewLabel('') } }}
                placeholder={prompt} className="text-xs rounded px-2 py-1"
                style={{ border: `1px solid ${BLUE}`, color: BLUE, background: '#fff', outline: 'none', width: '16rem' }} />
              <button onClick={() => addRow(section)} disabled={busy || !newLabel.trim()} className="cd-btn-sec text-xs">Add</button>
              <button onClick={() => { setAddingTo(null); setNewLabel('') }} className="text-xs cd-muted hover:underline">cancel</button>
            </span>
          ) : (
            <button onClick={() => { setAddingTo(section); setNewLabel('') }} disabled={busy}
              className="text-xs hover:underline" style={{ color: BLUE }}>
              + Add row
            </button>
          )}
        </td>
      </tr>
    )
  }

  const pctRow = (label: string, values: number[], yearVal: number | null) => (
    <tr key={label}>
      <td className="px-3 py-1 text-xs italic whitespace-nowrap"
        style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1 text-right text-xs italic tabular-nums"
          style={{ color: v < 0 ? 'rgba(45,25,7,0.3)' : 'rgba(45,25,7,0.55)' }}>
          {v < 0 ? '–' : `${v}%`}
        </td>
      ))}
      <td className="px-2 py-1 text-right text-xs italic tabular-nums"
        style={{ color: 'rgba(45,25,7,0.65)', borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
        {yearVal == null ? '–' : `${yearVal}%`}
      </td>
    </tr>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs cd-muted">
          {forecast ? (
            <span>Estimates from your Excel model, spread monthly — switch to <strong>Actuals</strong> for live figures.</span>
          ) : (
            <>
              <span><span className="font-semibold" style={{ color: INK }}>Black</span> — live from the OS; updates automatically.</span>
              <span><span className="font-semibold" style={{ color: BLUE }}>Blue</span> — hard-keyed by the accountant.</span>
              {editMode && <span>Blank cell = use the OS figure · <span className="font-semibold" style={{ color: RED }}>✕ delete</span> removes any row (OS-linked rows are restorable below; added rows go for good) · totals recalculate on Save.</span>}
            </>
          )}
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          {forecast ? (
            <span className="cd-pill" style={{ background: 'rgba(231,206,122,0.4)', color: '#7a5c00' }}>estimates</span>
          ) : editMode ? (
            <>
              <button onClick={save} disabled={busy} className="cd-btn text-sm">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={cancelEdit} disabled={busy} className="cd-btn-sec text-sm">Cancel</button>
            </>
          ) : (
            <button onClick={beginEdit} className="cd-btn-sec text-sm">✎ Edit</button>
          )}
        </div>
      </div>

      {editMode && s.hiddenRows.length > 0 && (
        <div className="rounded-xl px-4 py-2.5 text-xs flex flex-wrap items-center gap-2"
          style={{ background: 'rgba(45,25,7,0.05)', border: '1px dashed rgba(45,25,7,0.2)' }}>
          <span className="cd-muted">Removed from {s.year}:</span>
          {s.hiddenRows.map(h => (
            <button key={h.rowKey} onClick={() => restoreRow(h.rowKey)} disabled={busy}
              className="px-2 py-0.5 rounded-full font-medium hover:opacity-80"
              style={{ background: 'rgba(45,25,7,0.08)', color: INK, border: '1px solid rgba(45,25,7,0.15)' }}>
              ↩ {h.label}
            </button>
          ))}
          <span className="cd-muted">— tap to restore (OS figures return to the totals).</span>
        </div>
      )}

      <div className="cd-card overflow-x-auto">
        <table className="text-xs w-full" style={{ borderCollapse: 'collapse', minWidth: '68rem' }}>
          <thead>
            <tr className="cd-thead">
              <th style={{ position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>RM</th>
              {s.months.map(m => <th key={m} className="text-right px-2">{m}</th>)}
              <th className="text-right px-2" style={{ borderLeft: '1px solid rgba(45,25,7,0.15)' }}>{s.year} Total</th>
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {sectionHead('Revenue')}
            {s.revenue.map(leafRow)}
            {addRowLine('rev', 'e.g. Events Revenue')}
            {derivedRow(s.totalRevenue, { bold: true, topRule: true })}

            {sectionHead('Cost of Services (variable)')}
            {s.cogs.map(leafRow)}
            {addRowLine('cogs', 'e.g. Packaging')}
            {derivedRow(s.totalCogs, { bold: true, topRule: true })}
            {derivedRow(s.grossProfit, { bold: true })}
            {pctRow('Gross Margin %', s.grossMarginPct, s.yearGrossMarginPct)}

            {sectionHead('Operating Expenses (fixed)')}
            {s.opex.map(leafRow)}
            {addRowLine('opex', 'e.g. Depreciation')}
            {derivedRow(s.totalOpex, { bold: true, topRule: true })}

            {derivedRow(s.ebitda, { bold: true, topRule: true })}
            {pctRow('EBITDA Margin %', s.ebitdaMarginPct, s.yearEbitdaMarginPct)}
            {leafRow(s.tax)}
            {derivedRow(s.netIncome, { bold: true, topRule: true })}
            <tr>
              <td className="px-3 py-1.5 whitespace-nowrap text-xs italic"
                style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>
                Cumulative Net Income
              </td>
              {s.cumulativeNet.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right text-xs italic tabular-nums"
                  style={{ color: v < 0 ? RED : 'rgba(45,25,7,0.65)' }}>
                  {fmt(v)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right text-xs italic tabular-nums"
                style={{ color: s.netIncome.total < 0 ? RED : 'rgba(45,25,7,0.65)', borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
                {fmt(s.netIncome.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
