'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from './NavIcons'
import {
  PINNED, AI_LINKS, AI_SECTION, SEGMENTS, ALWAYS_ALLOWED, pathAllowed,
  type NavLink, type NavSegment,
} from '@/lib/nav-catalogue'

// The nav renders from lib/nav-catalogue — the same list the role editor ticks
// and access control checks. Three readers, one source: a tab the owner turned
// off must not merely be hidden here, and a tab they turned on must not be
// missing.
const segmentLinks = (s: NavSegment) => s.groups.flatMap(g => g.links)

const STORE_KEY = 'cd-nav-open'
const COLLAPSE_KEY = 'cd-nav-collapsed'

// Below this the sidebar stops being a column and becomes a drawer.
//
// 768 rather than a phone width, because tablets are the primary floor device:
// at 768 the fixed 224px sidebar leaves 544px, which is workable, and below it
// the page had 151px to live in — 103px after padding. Groomers and boarding
// carers are the people least likely to be at a desk and the ones this hurt.
const DRAWER_BELOW = 768

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/'
  if (href === '/rooms' && pathname.startsWith('/rooms/calendar')) return false // calendar has its own entry
  return pathname.startsWith(href)
}

export function Nav({ role, userName, logoUrl, brandName, visiblePaths, staffNav }: {
  role: string; userName?: string; logoUrl: string; brandName: string
  /** Tabs this role may open. `null` means unrestricted (the Manager role). */
  visiblePaths?: string[] | null
  /** Pinned tabs plus the owner-named drop-downs, resolved server-side. */
  staffNav?: { pinned: NavLink[]; groups: { label: string; links: NavLink[] }[] } | null
}) {
  const isManager = role === 'Manager'

  // The staff sidebar is arranged by the OWNER — pinned tabs, then named
  // drop-downs — and resolved on the server from the role's layout. Falls back
  // to a flat lane only when a role predates the layout column.
  const lane: NavLink[] = [
    ...ALWAYS_ALLOWED,
    ...[...PINNED, ...AI_LINKS, ...SEGMENTS.flatMap(segmentLinks)]
      .filter(l => visiblePaths != null && pathAllowed(l.href, visiblePaths)),
  ]

  // Managers see everything; a restricted role sees only what it holds.
  const allowed = (l: NavLink) => visiblePaths == null || pathAllowed(l.href, visiblePaths)
  const pinned = PINNED.filter(allowed)
  const aiLinks = AI_LINKS.filter(allowed)
  const segments = SEGMENTS
    .map(s => ({ ...s, groups: s.groups.map(g => ({ ...g, links: g.links.filter(allowed) })).filter(g => g.links.length > 0) }))
    .filter(s => s.groups.length > 0)
  const pathname = usePathname()

  // Collapsed was `useState(false)`, so it re-expanded on every full load and
  // the preference never survived. Read after mount, not during, or the server
  // and client render different widths and hydration complains.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1') } catch { /* private mode */ }
  }, [])
  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }

  // The drawer, below DRAWER_BELOW only. Deliberately NOT persisted: a menu
  // that reopens itself on every page is a menu covering the page.
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { setDrawer(false) }, [pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    const onResize = () => { if (window.innerWidth >= DRAWER_BELOW) setDrawer(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
  }, [drawer])

  // Which drop-down holds the current page. Intelligence is one of them, so it
  // opens itself for the same reason a segment does: nobody should be looking at
  // a screen whose own menu is shut.
  const sectionHolding = (path: string): string | undefined =>
    AI_LINKS.some(l => isActive(l.href, path))
      ? AI_SECTION.key
      : SEGMENTS.find(s => segmentLinks(s).some(l => isActive(l.href, path)))?.key

  // Open sections: start with the one holding the current page, then merge the
  // user's saved preference after mount (avoids SSR hydration mismatch).
  const [open, setOpen] = useState<string[]>(() => {
    const here = sectionHolding(pathname)
    return here ? [here] : ['ops']
  })
  useEffect(() => {
    try {
      const stored: string[] = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
      setOpen(prev => [...new Set([...stored, ...prev])])
    } catch { /* first visit */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const here = sectionHolding(pathname)
    if (here) setOpen(prev => (prev.includes(here) ? prev : [...prev, here]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function toggle(key: string) {
    setOpen(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

  const linkRow = (l: NavLink, indent = false, big = false) => {
    const active = isActive(l.href, pathname)
    return (
      <Link
        key={l.href}
        href={l.href}
        className={`flex items-center rounded mx-1 transition-all ${big ? 'gap-3 py-3 text-[15px] font-medium' : 'gap-2.5 py-1.5 text-sm'} ${indent && !collapsed ? 'pl-7 pr-3' : 'px-3'}`}
        style={active
          ? { background: '#B14919', color: '#ECDBB6', fontWeight: 600 }
          : { color: 'rgba(236,219,182,0.65)' }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#ECDBB6' }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.65)' }}
      >
        <span className={`flex items-center justify-center shrink-0 ${big ? 'w-6' : 'w-4'}`}><Icon name={l.icon} size={big ? 21 : undefined} /></span>
        {!collapsed && <span className="flex-1 truncate">{l.label}</span>}
      </Link>
    )
  }

  return (
    <>
      {/* ── The floor bar, below the breakpoint only ──
          Fixed, so it survives the page scrolling under it, and tall enough to
          clear a thumb. Above 768 it does not exist and nothing changes. */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 px-3"
        style={{ height: 52, background: '#2D1907', borderBottom: '1px solid rgba(236,219,182,0.15)' }}>
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          aria-expanded={drawer}
          className="flex items-center justify-center rounded"
          style={{ width: 40, height: 40, color: '#ECDBB6' }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.7} strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={brandName} className="h-6 w-auto select-none" style={{ pointerEvents: 'none' }} />
      </div>

      {drawer && (
        <div className="md:hidden fixed inset-0 z-30" style={{ background: 'rgba(45,25,7,0.45)' }}
          onClick={() => setDrawer(false)} aria-hidden />
      )}

      <aside
        className={`flex flex-col transition-transform duration-200 md:transition-all
          fixed inset-y-0 left-0 z-40 md:static md:translate-x-0
          ${drawer ? 'translate-x-0' : '-translate-x-full'}
          ${collapsed ? 'md:w-14' : 'md:w-56'} w-64`}
        style={{ background: '#2D1907' }}>
      <div className="flex items-center justify-between px-3 py-4" style={{ borderBottom: '1px solid rgba(236,219,182,0.15)' }}>
        {!collapsed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={brandName} className="h-7 w-auto select-none" style={{ pointerEvents: 'none' }} />
        )}
        {/* Closes the drawer on the floor, collapses the column at a desk. */}
        <button
          onClick={() => setDrawer(false)}
          className="md:hidden p-1 rounded ml-auto flex items-center justify-center"
          style={{ color: '#ECDBB6', opacity: 0.6 }}
          aria-label="Close menu">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.7} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex p-1 rounded ml-auto transition-colors items-center justify-center"
          style={{ color: '#ECDBB6', opacity: 0.6 }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {!isManager ? (
          // ── Staff: a stripped, big-tap-target lane for just their job ──
          <div className="space-y-1">
            {(staffNav?.pinned ?? lane).map(l => linkRow(l, false, true))}
            {staffNav?.groups.map(g => {
              const isOpen = open.includes(`staff:${g.label}`)
              const hasActive = g.links.some(l => isActive(l.href, pathname))
              return (
                <div key={g.label}>
                  <button
                    onClick={() => toggle(`staff:${g.label}`)}
                    className="w-full flex items-center gap-2 px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase transition-colors"
                    style={{ color: hasActive ? '#ECDBB6' : 'rgba(236,219,182,0.5)', letterSpacing: '0.1em' }}
                  >
                    <span className="flex-1 text-left truncate">{g.label}</span>
                    <span style={{ fontSize: 10 }}>{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {/* Held open while it contains the current page, so a staff
                      member is never looking at a screen whose own menu is shut. */}
                  {(isOpen || hasActive) && (
                    <div className="space-y-1">{g.links.map(l => linkRow(l, false, true))}</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : collapsed ? (
          // ── Manager, collapsed rail: pinned + everything as icons ──
          <div className="space-y-0.5">
            {pinned.map(l => linkRow(l))}
            <div className="mx-3 my-2" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
            {aiLinks.map(l => linkRow(l))}
            {segments.map(s => (
              <div key={s.key}>
                <div className="mx-3 my-2" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
                {segmentLinks(s).map(l => linkRow(l))}
              </div>
            ))}
          </div>
        ) : (
          // ── Manager: pinned essentials + six segment dropdowns ──
          <>
            <div className="space-y-0.5 mb-2">{pinned.map(l => linkRow(l))}</div>
            <div className="mx-3 mb-1" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
            {aiLinks.length > 0 && (() => {
              const isOpen = open.includes(AI_SECTION.key)
              const hasActive = aiLinks.some(l => isActive(l.href, pathname))
              return (
                <div className="mb-0.5">
                  <button
                    onClick={() => toggle(AI_SECTION.key)}
                    className="w-full flex items-center gap-2 px-3 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase transition-colors"
                    style={{
                      color: hasActive ? '#ECDBB6' : 'rgba(236,219,182,0.5)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: AI_SECTION.color }} />
                    <span className="flex-1 text-left truncate">{AI_SECTION.header}</span>
                    <span className="text-[10px]" style={{ opacity: 0.6 }}>{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && <div className="pb-1">{aiLinks.map(l => linkRow(l, true))}</div>}
                </div>
              )
            })()}
            <div className="mx-3 mb-1" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />
            {segments.map(s => {
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
            {userName}{!isManager && ` · ${role}`}
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
    </>
  )
}
