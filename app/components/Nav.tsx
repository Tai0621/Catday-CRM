'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from './NavIcons'
import {
  PINNED, AI_LINKS, SEGMENTS, ALWAYS_ALLOWED, pathAllowed,
  type NavLink, type NavSegment,
} from '@/lib/nav-catalogue'

// The nav renders from lib/nav-catalogue — the same list the role editor ticks
// and access control checks. Three readers, one source: a tab the owner turned
// off must not merely be hidden here, and a tab they turned on must not be
// missing.
const segmentLinks = (s: NavSegment) => s.groups.flatMap(g => g.links)

const STORE_KEY = 'cd-nav-open'

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/'
  if (href === '/rooms' && pathname.startsWith('/rooms/calendar')) return false // calendar has its own entry
  return pathname.startsWith(href)
}

export function Nav({ role, userName, logoUrl, brandName, visiblePaths }: {
  role: string; userName?: string; logoUrl: string; brandName: string
  /** Tabs this role may open. `null` means unrestricted (the Manager role). */
  visiblePaths?: string[] | null
}) {
  const isManager = role === 'Manager'

  // The staff lane is DERIVED from the role's allowed tabs, in catalogue order,
  // rather than being a second hand-maintained list. The old version kept a
  // separate ROLE_LINKS map that had to "mirror lib/roles.ts" by convention —
  // which is exactly the kind of mirror that drifts the first time someone
  // edits one side.
  const staffLane: NavLink[] = [
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
    <aside className={`flex flex-col transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'}`}
      style={{ background: '#2D1907' }}>
      <div className="flex items-center justify-between px-3 py-4" style={{ borderBottom: '1px solid rgba(236,219,182,0.15)' }}>
        {!collapsed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={brandName} className="h-7 w-auto select-none" style={{ pointerEvents: 'none' }} />
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
          // ── Staff: a stripped, big-tap-target lane for just their job ──
          <div className="space-y-1">{staffLane.map(l => linkRow(l, false, true))}</div>
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
            <div
              className="px-3 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase"
              style={{
                color: AI_LINKS.some(l => isActive(l.href, pathname)) ? '#ECDBB6' : 'rgba(236,219,182,0.5)',
                letterSpacing: '0.1em',
              }}
            >
              AI
            </div>
            <div className="space-y-0.5 mb-2">{aiLinks.map(l => linkRow(l))}</div>
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
  )
}
