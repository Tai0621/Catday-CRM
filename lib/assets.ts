import { db } from './db'

// Fixed Asset Register — straight-line depreciation, the single source for the
// three statements' fixed-asset figures. Pure functions here so finance.ts,
// balance-sheet.ts and cash-flow.ts share one consistent depreciation model
// (and so it's unit-testable). Finance reads these; it never writes assets.

export const ASSET_CATEGORIES = [
  'Equipment', 'Furniture & Fixtures', 'Renovation & Fit-out',
  'IT & Software', 'Vehicle', 'Other',
] as const
export type AssetCategory = typeof ASSET_CATEGORIES[number]

// The columns the depreciation math needs — everything else (name/notes) is UI.
export type AssetCore = {
  cost: number
  salvageValue: number
  purchaseDate: Date
  usefulLifeMonths: number
}

const r2 = (v: number) => Math.round(v * 100) / 100
const monthIdxOf = (d: Date) => d.getFullYear() * 12 + d.getMonth()
const asOfIdxOf = (asOf: string) => { const [y, m] = asOf.split('-').map(Number); return y * 12 + (m - 1) } // 'YYYY-MM' → absolute month index

// Full monthly charge = depreciable base spread evenly over the life.
export function monthlyDepreciation(a: AssetCore): number {
  if (a.usefulLifeMonths <= 0) return 0
  return r2((a.cost - a.salvageValue) / a.usefulLifeMonths)
}

// Depreciation charged in one specific calendar month. The purchase month is
// month 0; the last month carries the rounding remainder so lifetime charges
// sum to exactly (cost − salvage).
export function depreciationInMonth(a: AssetCore, year: number, monthIndex0: number): number {
  const k = (year * 12 + monthIndex0) - monthIdxOf(a.purchaseDate)
  if (k < 0 || k >= a.usefulLifeMonths) return 0
  const md = monthlyDepreciation(a)
  if (k === a.usefulLifeMonths - 1) return r2((a.cost - a.salvageValue) - md * (a.usefulLifeMonths - 1))
  return md
}

// Accumulated depreciation as at the end of `asOf` month (inclusive). Exact
// counterpart of summing depreciationInMonth — capped at the depreciable base.
export function accumulatedDepreciation(a: AssetCore, asOf: string): number {
  const charged = asOfIdxOf(asOf) - monthIdxOf(a.purchaseDate) + 1
  if (charged <= 0) return 0
  if (charged >= a.usefulLifeMonths) return r2(a.cost - a.salvageValue)
  return r2(monthlyDepreciation(a) * charged)
}

// Net book value at the end of `asOf` month; 0 before the asset was acquired.
export function netBookValue(a: AssetCore, asOf: string): number {
  if (monthIdxOf(a.purchaseDate) > asOfIdxOf(asOf)) return 0
  return r2(a.cost - accumulatedDepreciation(a, asOf))
}

// Balance sheet: total NBV of the whole register at a month-end.
export function fixedAssetsNBV(assets: AssetCore[], asOf: string): number {
  return r2(assets.reduce((s, a) => s + netBookValue(a, asOf), 0))
}

// Income statement: the 12 monthly depreciation totals for a year.
export function depreciationForYear(assets: AssetCore[], year: number): number[] {
  return Array.from({ length: 12 }, (_, m) => r2(assets.reduce((s, a) => s + depreciationInMonth(a, year, m), 0)))
}

// Cash flow: total depreciation charged in the months (fromMonth, toMonth] —
// the non-cash add-back for the period, matching the two balance-sheet ends.
export function depreciationBetween(assets: AssetCore[], fromMonth: string, toMonth: string): number {
  return r2(assets.reduce((s, a) => s + (accumulatedDepreciation(a, toMonth) - accumulatedDepreciation(a, fromMonth)), 0))
}

// One place to pull the depreciation-relevant columns (never Cat-style bloat).
export function fetchAssetCores() {
  return db.fixedAsset.findMany({ select: { cost: true, salvageValue: true, purchaseDate: true, usefulLifeMonths: true } })
}
