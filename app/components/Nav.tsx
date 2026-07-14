'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

// seg = business-segment colour dot: grooming terracotta, boarding teal,
// membership gold, community moss, business cream (matches lib/segments.ts)
const SEG_COLORS: Record<string, string> = {
  grooming: '#C86A3C',
  boarding: '#729094',
  membership: '#E7CE7A',
  community: '#98A86B',
  business: '#ECDBB6',
}

type NavLink = { href: string; label: string; icon: string; seg?: string; managerOnly?: boolean }

const sections: { header: string; links: NavLink[] }[] = [
  {
    header: 'Today',
    links: [
      { href: '/', label: 'Dashboard', icon: '⊞', seg: 'business', managerOnly: true },
      { href: '/actions', label: 'Actions', icon: '◎' },
      { href: '/board', label: 'Service Board', icon: '◫', seg: 'grooming' },
      { href: '/runsheet', label: 'Run Sheet', icon: '☰', seg: 'boarding' },
      { href: '/appointments', label: 'Appointments', icon: '◷', seg: 'grooming' },
      { href: '/rooms', label: 'Rooms', icon: '▦', seg: 'boarding' },
      { href: '/sale', label: 'Quick Sale', icon: '⬒', seg: 'business' },
    ],
  },
  {
    header: 'Customers',
    links: [
      { href: '/customers', label: 'Customers', icon: '◉', seg: 'community' },
      { href: '/cats', label: 'Cats', icon: '◈', seg: 'grooming' },
      { href: '/memberships', label: 'Memberships', icon: '◆', seg: 'membership' },
      { href: '/whatsapp', label: 'WhatsApp', icon: '✆', seg: 'community', managerOnly: true },
      { href: '/incidents', label: 'Incidents', icon: '⚠' },
    ],
  },
  {
    header: 'Business',
    links: [
      { href: '/revenue', label: 'Revenue', icon: '◐', seg: 'business', managerOnly: true },
      { href: '/cashup', label: 'Cash-up', icon: '▣', seg: 'business', managerOnly: true },
      { href: '/plan', label: 'Financial Plan', icon: '◔', seg: 'business', managerOnly: true },
      { href: '/services', label: 'Services', icon: '✂', seg: 'grooming', managerOnly: true },
      { href: '/staff', label: 'Staff', icon: '♟', seg: 'business', managerOnly: true },
      { href: '/academy', label: 'Academy', icon: '◑', seg: 'business', managerOnly: true },
      { href: '/ask', label: 'Ask AI', icon: '✦', managerOnly: true },
    ],
  },
]

export function Nav({ isManager, userName }: { isManager: boolean; userName?: string }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const visibleSections = sections
    .map(s => ({ ...s, links: s.links.filter(l => isManager || !l.managerOnly) }))
    .filter(s => s.links.length > 0)

  return (
    <aside className={`flex flex-col transition-all duration-200 ${collapsed ? 'w-14' : 'w-52'}`}
      style={{ background: '#2D1907' }}>
      <div className="flex items-center justify-between px-3 py-4" style={{ borderBottom: '1px solid rgba(236,219,182,0.15)' }}>
        {!collapsed && (
          <span className="font-bold text-base tracking-widest uppercase" style={{ fontFamily: 'var(--font-brand)', color: '#ECDBB6', letterSpacing: '0.12em' }}>
            cat day
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded ml-auto text-xs transition-colors"
          style={{ color: '#ECDBB6', opacity: 0.6 }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {visibleSections.map(section => (
          <div key={section.header} className="mb-1">
            {!collapsed && (
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase"
                style={{ color: 'rgba(236,219,182,0.35)', letterSpacing: '0.15em' }}>
                {section.header}
              </div>
            )}
            {collapsed && <div className="mx-3 my-2" style={{ borderTop: '1px solid rgba(236,219,182,0.12)' }} />}
            <div className="space-y-0.5">
              {section.links.map(({ href, label, icon, seg }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-sm rounded mx-1 transition-all"
                    style={active
                      ? { background: '#B14919', color: '#ECDBB6', fontWeight: 600 }
                      : { color: 'rgba(236,219,182,0.65)' }
                    }
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#ECDBB6' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.65)' }}
                  >
                    <span className="text-sm w-4 text-center">{icon}</span>
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {!collapsed && seg && !active && (
                      <span className="rounded-full" style={{ width: 5, height: 5, background: SEG_COLORS[seg], opacity: 0.85 }} />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
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
            <span>↩</span>
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
