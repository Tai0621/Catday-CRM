'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from './NavIcons'

type NavLink = { href: string; label: string; icon: string }
// A segment's links can be split into named sub-groups (e.g. Grooming / Boarding / Sales)
type NavGroup = { sub?: string; subColor?: string; links: NavLink[] }
type NavSegment = { key: string; header: string; color: string; groups: NavGroup[] }

const segmentLinks = (s: NavSegment) => s.groups.flatMap(g => g.links)

// Pinned above the segments — the owner's daily spine, not tied to one segment
const PINNED: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/actions', label: 'Action Inbox', icon: 'inbox' },
  { href: '/ask', label: 'Ask AI', icon: 'ai' },
]

// The six business segments — the OS map. Colours match lib/segments.ts.
const SEGMENTS: NavSegment[] = [
  {
    key: 'ops', header: 'Operations & Sales', color: '#C86A3C',
    groups: [
      {
        sub: 'Grooming', subColor: '#C86A3C',
        links: [
          { href: '/board', label: 'Service Board', icon: 'board' },
          { href: '/services', label: 'Service Menu', icon: 'scissors' },
        ],
      },
      {
        sub: 'Boarding', subColor: '#729094',
        links: [
          { href: '/runsheet', label: 'Run Sheet', icon: 'runsheet' },
          { href: '/rooms/calendar', label: 'Room Calendar', icon: 'calendar' },
          { href: '/rooms', label: 'Rooms', icon: 'rooms' },
        ],
      },
      {
        sub: 'Sales', subColor: '#ECDBB6',
        links: [
          { href: '/appointments', label: 'Appointments', icon: 'clock' },
          { href: '/pos', label: 'POS Checkout', icon: 'pos' },
          { href: '/products', label: 'Products', icon: 'box' },
          { href: '/cashup', label: 'Cash-up', icon: 'wallet' },
        ],
      },
    ],
  },
  {
    key: 'hr', header: 'Human Resource', color: '#729094',
    groups: [{ links: [
      { href: '/staff', label: 'Staff & PINs', icon: 'staff' },
    ] }],
  },
  {
    key: 'finance', header: 'Finance', color: '#ECDBB6',
    groups: [
      {
        sub: '3-Statement', subColor: '#B8902B',
        links: [
          { href: '/finance/income-statement', label: 'Income Statement', icon: 'report' },
          { href: '/finance/balance-sheet', label: 'Balance Sheet', icon: 'scale' },
          { href: '/finance/cash-flow', label: 'Cash Flow', icon: 'trend' },
        ],
      },
      {
        sub: 'Records & Planning', subColor: '#729094',
        links: [
          { href: '/finance/expenses', label: 'Expenses', icon: 'receipt' },
          { href: '/finance/aging', label: 'Receivables & Payables', icon: 'wallet' },
          { href: '/revenue', label: 'Revenue', icon: 'bars' },
          { href: '/plan', label: 'Financial Plan', icon: 'compass' },
        ],
      },
    ],
  },
  {
    key: 'crm', header: 'Customers · CRM', color: '#98A86B',
    groups: [{ links: [
      { href: '/customers', label: 'Customers', icon: 'customers' },
      { href: '/cats', label: 'Cats', icon: 'cat' },
      { href: '/memberships', label: 'Memberships', icon: 'star' },
      { href: '/whatsapp', label: 'WhatsApp', icon: 'chat' },
      { href: '/incidents', label: 'Incidents', icon: 'alert' },
    ] }],
  },
  {
    key: 'marketing', header: 'Marketing', color: '#E7CE7A',
    groups: [{ links: [
      { href: '/academy', label: 'Academy', icon: 'cap' },
    ] }],
  },
  {
    key: 'admin', header: 'Administrative', color: 'rgba(236,219,182,0.45)',
    groups: [], // documents, SOP library, vendors, settings — next rounds
  },
]

// Staff see a flat, focused lane — no segment tree
const STAFF_LINKS: NavLink[] = [
  { href: '/actions', label: 'Action Inbox', icon: 'inbox' },
  { href: '/board', label: 'Service Board', icon: 'board' },
  { href: '/runsheet', label: 'Run Sheet', icon: 'runsheet' },
  { href: '/appointments', label: 'Appointments', icon: 'clock' },
  { href: '/rooms', label: 'Rooms', icon: 'rooms' },
  { href: '/pos', label: 'POS Checkout', icon: 'pos' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
  { href: '/cats', label: 'Cats', icon: 'cat' },
  { href: '/memberships', label: 'Memberships', icon: 'star' },
  { href: '/incidents', label: 'Incidents', icon: 'alert' },
]

const STORE_KEY = 'cd-nav-open'

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/'
  if (href === '/rooms' && pathname.startsWith('/rooms/calendar')) return false // calendar has its own entry
  return pathname.startsWith(href)
}

export function Nav({ isManager, userName }: { isManager: boolean; userName?: string }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Open segments: start with the one holding the current page, then merge the
  // user's saved preference after mount (avoids SSR hydration mismatch).
  const activeSegment = SEGMENTS.find(s => segmentLinks(s).some(l => isActive(l.href, pathname)))?.key
  const [open, setOpen] = useState<string[]>(activeSegment ? [activeSegment] : ['ops'])
  useEffect(() => {
    try {
      const stored: string[] = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
      setOpen(prev => [...new Set([...stored, ...prev])])
    } catch { /* first visit */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const seg = SEGMENTS.find(s => segmentLinks(s).some(l => isActive(l.href, pathname)))?.key
    if (seg) setOpen(prev => (prev.includes(seg) ? prev : [...prev, seg]))
  }, [pathname])

  function toggle(key: string) {
    setOpen(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

  const linkRow = (l: NavLink, indent = false) => {
    const active = isActive(l.href, pathname)
    return (
      <Link
        key={l.href}
        href={l.href}
        className={`flex items-center gap-2.5 py-1.5 text-sm rounded mx-1 transition-all ${indent && !collapsed ? 'pl-7 pr-3' : 'px-3'}`}
        style={active
          ? { background: '#B14919', color: '#ECDBB6', fontWeight: 600 }
          : { color: 'rgba(236,219,182,0.65)' }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#ECDBB6' }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.65)' }}
      >
        <span className="w-4 flex items-center justify-center shrink-0"><Icon name={l.icon} /></span>
        {!collapsed && <span className="flex-1 truncate">{l.label}</span>}
      </Link>
    )
  }

  return (
    <aside className={`flex flex-col transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'}`}
      style={{ background: '#2D1907' }}>
      <div className="flex items-center justify-between px-3 py-4" style={{ borderBottom: '1px solid rgba(236,219,182,0.15)' }}>
        {!collapsed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/catday-logo-cream.png" alt="Cat Day" className="h-7 w-auto select-none" style={{ pointerEvents: 'none' }} />
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded ml-auto transition-colors flex items-center justify-center"
          style={{ color: '#ECDBB6', opacity: 0.6 }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {!isManager ? (
          // ── Staff: flat lane ──
          <div className="space-y-0.5">{STAFF_LINKS.map(l => linkRow(l))}</div>
        ) : collapsed ? (
          // ── Manager, collapsed rail: pinned + everything as icons ──
          <div className="space-y-0.5">
            {PINNED.map(l => linkRow(l))}
            {SEGMENTS.filter(s => segmentLinks(s).length > 0).map(s => (
              <div key={s.key}>
                <div className="mx-3 my-2" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
                {segmentLinks(s).map(l => linkRow(l))}
              </div>
            ))}
          </div>
        ) : (
          // ── Manager: pinned essentials + six segment dropdowns ──
          <>
            <div className="space-y-0.5 mb-2">{PINNED.map(l => linkRow(l))}</div>
            <div className="mx-3 mb-1" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
            {SEGMENTS.map(s => {
              const isOpen = open.includes(s.key)
              const hasActive = segmentLinks(s).some(l => isActive(l.href, pathname))
              const empty = segmentLinks(s).length === 0
              return (
                <div key={s.key} className="mb-0.5">
                  <button
                    onClick={() => !empty && toggle(s.key)}
                    className="w-full flex items-center gap-2 px-3 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase transition-colors"
                    style={{
                      color: hasActive ? '#ECDBB6' : 'rgba(236,219,182,0.5)',
                      letterSpacing: '0.1em',
                      cursor: empty ? 'default' : 'pointer',
                    }}
                  >
                    <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: s.color }} />
                    <span className="flex-1 text-left truncate">{s.header}</span>
                    {empty
                      ? <span className="text-[9px] normal-case font-normal" style={{ color: 'rgba(236,219,182,0.35)', letterSpacing: 0 }}>soon</span>
                      : <span className="text-[10px]" style={{ opacity: 0.6 }}>{isOpen ? '▾' : '▸'}</span>}
                  </button>
                  {isOpen && !empty && (
                    <div className="pb-1">
                      {s.groups.map((g, gi) => (
                        <div key={g.sub ?? gi} className="space-y-0.5">
                          {g.sub && (
                            <div className="flex items-center gap-1.5 pl-7 pr-3 pt-1.5 pb-0.5 text-[10px] uppercase"
                              style={{ color: 'rgba(236,219,182,0.4)', letterSpacing: '0.12em' }}>
                              <span className="rounded-full shrink-0" style={{ width: 5, height: 5, background: g.subColor ?? s.color, opacity: 0.9 }} />
                              {g.sub}
                            </div>
                          )}
                          {g.links.map(l => linkRow(l, true))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </nav>

      <div className="px-3 py-3 space-y-1.5" style={{ borderTop: '1px solid rgba(236,219,182,0.15)' }}>
        {!collapsed && userName && (
          <div className="text-xs truncate" style={{ color: 'rgba(236,219,182,0.55)' }}>
            {userName}{!isManager && ' · staff'}
          </div>
        )}
        <form action="/api/logout" method="POST">
          <button
            type="submit"
            className={`flex items-center gap-2 text-xs w-full transition-colors ${collapsed ? 'justify-center' : ''}`}
            style={{ color: 'rgba(236,219,182,0.45)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.8)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.45)' }}
          >
            <Icon name="logout" size={15} />
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
