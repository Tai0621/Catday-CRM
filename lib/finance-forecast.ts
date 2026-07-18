// The owner's "CATDAY Income Statement.xlsx", embedded verbatim so the app can
// show the estimated statement beside actuals. Conservative scenario:
// utilization ramps 5%→35% in Year 1, 20% average; RM88/night boarding,
// RM128 grooming; 24% corporate tax. Update here if the Excel model changes.

export type ForecastRow = { label: string; values: number[]; indent?: boolean; bold?: boolean; topRule?: boolean }

export const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030]

// ── "Income Statement" sheet: 5-year annual forecast ──
export const FIVE_YEAR: { section: string | null; rows: ForecastRow[] }[] = [
  {
    section: 'Revenue',
    rows: [
      { label: 'Boarding Revenue', values: [316800, 554400, 792000, 950400, 1108800], indent: true },
      { label: 'Grooming Revenue', values: [110592, 193536, 276480, 331776, 387072], indent: true },
      { label: 'Membership – Baby Cat Member', values: [9975, 17955, 25935, 33915, 39900], indent: true },
      { label: 'Membership – Senior Cat Owner', values: [8985, 17970, 26955, 35940, 44925], indent: true },
      { label: 'Membership – Skin Problem Package', values: [6990, 13980, 22368, 29358, 34950], indent: true },
      { label: 'Membership – Premium Package', values: [7992, 14985, 24975, 34965, 44955], indent: true },
      { label: 'Events Revenue', values: [18000, 21600, 25920, 31104, 37325], indent: true },
      { label: 'Academy Revenue', values: [36000, 43200, 51840, 62208, 74650], indent: true },
      { label: 'Total Revenue', values: [515334, 877626, 1246473, 1509666, 1772576], bold: true, topRule: true },
    ],
  },
  {
    section: 'Cost of Services (variable)',
    rows: [
      { label: 'Grooming Supplies', values: [14400, 25548, 37000, 45013, 53240], indent: true },
      { label: 'Food & Litter', values: [57600, 102191, 148002, 180053, 212961], indent: true },
      { label: 'Vet Visit', values: [20800, 36902, 53445, 65019, 76903], indent: true },
      { label: 'Total Cost of Services', values: [92800, 164641, 238447, 290086, 343104], bold: true, topRule: true },
      { label: 'Gross Profit', values: [422534, 712985, 1008026, 1219580, 1429473], bold: true },
    ],
  },
  {
    section: 'Operating Expenses (fixed)',
    rows: [
      { label: 'Rent', values: [204000, 206815, 209669, 212563, 215496], indent: true },
      { label: 'Salaries', values: [249600, 253044, 256536, 260077, 263666], indent: true },
      { label: 'Cleaning Supplies', values: [10200, 10341, 10483, 10628, 10775], indent: true },
      { label: 'Utilities', values: [48000, 48662, 49334, 50015, 50705], indent: true },
      { label: 'Marketing', values: [66000, 66911, 67834, 68770, 69719], indent: true },
      { label: 'Maintenance', values: [12000, 12166, 12333, 12504, 12676], indent: true },
      { label: 'Total Operating Expenses', values: [589800, 597939, 606191, 614556, 623037], bold: true, topRule: true },
    ],
  },
  {
    section: null,
    rows: [
      { label: 'EBITDA (Operating Income)', values: [-167266, 115046, 401835, 605024, 806436], bold: true, topRule: true },
      { label: 'Tax Expense (@ 24%)', values: [0, 27611, 96440, 145206, 193545], indent: true },
      { label: 'Net Income', values: [-167266, 87435, 305394, 459818, 612891], bold: true, topRule: true },
      { label: 'Cumulative Net Income', values: [-167266, -79831, 225563, 685382, 1298273] },
    ],
  },
]

export const FIVE_YEAR_PCTS: { label: string; values: string[] }[] = [
  { label: 'Utilization %', values: ['20.0%', '35.0%', '50.0%', '60.0%', '70.0%'] },
  { label: 'Gross Margin %', values: ['82.0%', '81.2%', '80.9%', '80.8%', '80.6%'] },
  { label: 'EBITDA Margin %', values: ['-32.5%', '13.1%', '32.2%', '40.1%', '45.5%'] },
  { label: 'Net Margin %', values: ['-32.5%', '10.0%', '24.5%', '30.5%', '34.6%'] },
]

// ── "Year1 Monthly" sheet: month-by-month ramp-up build (2026) ──
export const YEAR1_MONTHLY: { section: string | null; rows: ForecastRow[] }[] = [
  {
    section: 'Revenue build',
    rows: [
      { label: 'Boarding Revenue', values: [6600, 10200, 13800, 17400, 21000, 24600, 28200, 31800, 35400, 39000, 42600, 46200], indent: true },
      { label: 'Grooming Revenue', values: [2304, 3561, 4817, 6074, 7331, 8588, 9844, 11101, 12358, 13615, 14871, 16128], indent: true },
      { label: 'Membership Revenue', values: [707, 1093, 1479, 1864, 2250, 2636, 3021, 3407, 3793, 4178, 4564, 4950], indent: true },
      { label: 'Events Revenue', values: [375, 580, 784, 989, 1193, 1398, 1602, 1807, 2011, 2216, 2420, 2625], indent: true },
      { label: 'Academy Revenue', values: [750, 1159, 1568, 1977, 2386, 2795, 3205, 3614, 4023, 4432, 4841, 5250], indent: true },
      { label: 'Total Revenue', values: [10736, 16592, 22448, 28304, 34160, 40016, 45873, 51729, 57585, 63441, 69297, 75153], bold: true, topRule: true },
    ],
  },
  {
    section: 'Operating expenses',
    rows: [
      { label: 'Rent', values: Array(12).fill(17000), indent: true },
      { label: 'Salaries', values: Array(12).fill(20800), indent: true },
      { label: 'Cleaning Supplies', values: Array(12).fill(850), indent: true },
      { label: 'Grooming Supplies', values: Array(12).fill(1200), indent: true },
      { label: 'Utilities', values: Array(12).fill(4000), indent: true },
      { label: 'Food & Litter', values: Array(12).fill(4800), indent: true },
      { label: 'Marketing', values: Array(12).fill(5500), indent: true },
      { label: 'Vet Visit', values: [2000, 2000, 1680, 1680, 1680, 1680, 1680, 1680, 1680, 1680, 1680, 1680], indent: true },
      { label: 'Maintenance', values: Array(12).fill(1000), indent: true },
      { label: 'Total OpEx', values: [57150, 57150, 56830, 56830, 56830, 56830, 56830, 56830, 56830, 56830, 56830, 56830], bold: true, topRule: true },
    ],
  },
  {
    section: null,
    rows: [
      { label: 'Net Operating Income', values: [-46414, -40558, -34382, -28526, -22670, -16814, -10957, -5101, 755, 6611, 12467, 18323], bold: true, topRule: true },
      { label: 'Cumulative Net Operating Income', values: [-46414, -86972, -121353, -149879, -172549, -189362, -200320, -205421, -204666, -198056, -185589, -167266] },
    ],
  },
]

export const YEAR1_UTILIZATION = ['5.0%', '7.7%', '10.5%', '13.2%', '15.9%', '18.6%', '21.4%', '24.1%', '26.8%', '29.5%', '32.3%', '35.0%']

export const rowTotal = (r: ForecastRow) => r.values.reduce((s, v) => s + v, 0)

// ── The forecast rendered as a monthly IncomeStatement (same shape as
// actuals, so both views share one layout). 2026 uses the Excel's monthly
// ramp; 2027–2030 spread the flat annual figures evenly (faithful to the
// model's flat utilization); other years are zero.
import { composeStatement, makeRow, blank12, type IncomeStatement, type StatementRow } from './finance'
import { REVENUE_CATEGORIES } from './constants'
import { COGS_CATEGORIES, OPEX_CATEGORIES } from './finance'

const flat = (groups: { rows: ForecastRow[] }[]) => groups.flatMap(g => g.rows)
const FY = flat(FIVE_YEAR)
const Y1 = flat(YEAR1_MONTHLY)
const fyVal = (label: string, yearIdx: number) => FY.find(r => r.label === label)?.values[yearIdx] ?? 0
const y1Months = (label: string) => Y1.find(r => r.label === label)?.values ?? blank12()

// Spread an annual figure over 12 months; last month absorbs rounding
const spread = (annual: number): number[] => {
  const monthly = Math.round((annual / 12) * 100) / 100
  const values = Array.from({ length: 12 }, () => monthly)
  values[11] = Math.round((annual - monthly * 11) * 100) / 100
  return values
}

export function buildForecastStatement(year: number): IncomeStatement {
  const yearIdx = FORECAST_YEARS.indexOf(year)
  const isY1 = year === FORECAST_YEARS[0]
  const inModel = yearIdx >= 0

  // Map the Excel's streams onto the actuals row set
  // (tiers sum into Membership; Events lands in Other; no Retail forecast)
  const revenueOf = (cat: string): number[] => {
    if (!inModel) return blank12()
    if (isY1) {
      if (cat === 'Membership') return y1Months('Membership Revenue')
      if (cat === 'Other') return y1Months('Events Revenue')
      if (cat === 'Retail') return blank12()
      return y1Months(`${cat} Revenue`)
    }
    if (cat === 'Membership') {
      return spread(
        fyVal('Membership – Baby Cat Member', yearIdx) + fyVal('Membership – Senior Cat Owner', yearIdx) +
        fyVal('Membership – Skin Problem Package', yearIdx) + fyVal('Membership – Premium Package', yearIdx))
    }
    if (cat === 'Other') return spread(fyVal('Events Revenue', yearIdx))
    if (cat === 'Retail') return blank12()
    return spread(fyVal(`${cat} Revenue`, yearIdx))
  }

  const expenseOf = (cat: string): number[] => {
    if (!inModel) return blank12()
    if (isY1) return y1Months(cat) // absent labels (Retail Stock, Other Expense) → zeros
    return FY.some(r => r.label === cat) ? spread(fyVal(cat, yearIdx)) : blank12()
  }

  const revenue: StatementRow[] = REVENUE_CATEGORIES.map(c => makeRow(`${c} Revenue`, revenueOf(c)))
  const cogs: StatementRow[] = COGS_CATEGORIES.map(c => makeRow(c, expenseOf(c)))
  const opex: StatementRow[] = OPEX_CATEGORIES.map(c => makeRow(c, expenseOf(c)))
  const taxValues = !inModel ? blank12() : isY1 ? blank12() : spread(fyVal('Tax Expense (@ 24%)', yearIdx))

  return composeStatement({
    year, revenue, cogs, opex,
    makeTax: () => makeRow('Tax (per model)', taxValues),
    availableYears: [...FORECAST_YEARS],
  })
}
