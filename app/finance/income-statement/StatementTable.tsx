'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IncomeStatement, StatementRow } from '@/lib/finance'
import { saveStatementCell } from './actions'

// Accounting colour convention: BLACK figures flow live from the OS
// (checkout, expenses); BLUE figures are hard-keyed by the accountant.
const INK = '#2D1907'
const BLUE = '#1D4ED8'
const RED = '#B14919'
const SEG_TEXT = '#5C4A32'

const fmt = (v: number) =>
  v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
    : v === 0 ? '–'
    : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

export function StatementTable({ statement: s }: { statement: IncomeStatement }) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ rowKey: string; month: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function beginEdit(r: StatementRow, m: number) {
    if (!r.key || busy) return
    setEditing({ rowKey: r.key, month: m })
    setDraft(r.overridden?.[m] ? String(r.values[m]) : '')
    setError(null)
  }

  async function commit(clear = false) {
    if (!editing) return
    const trimmed = draft.trim()
    const amount = clear || trimmed === '' ? null : parseFloat(trimmed)
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) { setError('Enter a valid amount.'); return }
    setBusy(true)
    const res = await saveStatementCell(JSON.stringify({ year: s.year, month: editing.month, rowKey: editing.rowKey, amount }))
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setEditing(null)
    router.refresh()
  }

  const leafCell = (r: StatementRow, m: number) => {
    const isEditing = editing && editing.rowKey === r.key && editing.month === m
    if (isEditing) {
      return (
        <td key={m} className="px-1 py-1 text-right" style={{ minWidth: '4.6rem' }}>
          <input
            autoFocus
            type="number" min="0" step="0.01"
            value={draft}
            placeholder={String(r.autoValues?.[m] ?? 0)}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(null)
            }}
            className="w-full text-right text-xs rounded px-1 py-0.5"
            style={{ border: `1.5px solid ${BLUE}`, color: BLUE, background: '#fff', outline: 'none' }}
          />
        </td>
      )
    }
    const manual = r.overridden?.[m] ?? false
    return (
      <td key={m}
        onClick={() => beginEdit(r, m)}
        className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap cursor-pointer hover:opacity-70"
        title={manual
          ? `Manual entry — OS figure is RM ${(r.autoValues?.[m] ?? 0).toLocaleString('en-MY')}. Click to edit; clear to revert.`
          : 'Live from the OS. Click to hard-key a figure.'}
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
      {r.label}
    </td>
  )

  const leafRow = (r: StatementRow) => (
    <tr key={r.label}>
      {labelTd(r, { indent: true })}
      {r.values.map((_, m) => leafCell(r, m))}
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs cd-muted">
        <span><span className="font-semibold" style={{ color: INK }}>Black</span> — live from the OS (checkout, expenses); updates automatically.</span>
        <span><span className="font-semibold" style={{ color: BLUE }}>Blue</span> — hard-keyed by the accountant; click any monthly cell to enter, clear it to revert.</span>
        {error && <span style={{ color: RED }}>{error}</span>}
        {busy && <span>Saving…</span>}
      </div>

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
            {derivedRow(s.totalRevenue, { bold: true, topRule: true })}

            {sectionHead('Cost of Services (variable)')}
            {s.cogs.map(leafRow)}
            {derivedRow(s.totalCogs, { bold: true, topRule: true })}
            {derivedRow(s.grossProfit, { bold: true })}
            {pctRow('Gross Margin %', s.grossMarginPct, s.yearGrossMarginPct)}

            {sectionHead('Operating Expenses (fixed)')}
            {s.opex.map(leafRow)}
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
