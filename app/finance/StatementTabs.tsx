'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Shared tab bar across the three financial statements, so they read as one
// tabbed section. Preserves the ?year / ?asOf / ?to query where it makes sense
// is left to each page — tabs just switch statement.
const TABS = [
  { href: '/finance/income-statement', label: 'Income Statement' },
  { href: '/finance/balance-sheet', label: 'Balance Sheet' },
  { href: '/finance/cash-flow', label: 'Cash Flow' },
]

export function StatementTabs() {
  const pathname = usePathname()
  return (
    <div className="flex flex-wrap gap-1 p-1 rounded-xl w-fit"
      style={{ background: 'rgba(45,25,7,0.06)', border: '1px solid rgba(45,25,7,0.1)' }}>
      {TABS.map(t => {
        const active = pathname.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href}
            className="text-sm px-3.5 py-1.5 rounded-lg transition-colors"
            style={active
              ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
              : { color: 'rgba(45,25,7,0.6)' }}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
