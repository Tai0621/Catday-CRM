'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const links = [
  { href: '/', label: 'Dashboard', icon: '⊞' },
  { href: '/plan', label: 'Financial Plan', icon: '◔' },
  { href: '/appointments', label: 'Appointments', icon: '◷' },
  { href: '/customers', label: 'Customers', icon: '◉' },
  { href: '/cats', label: 'Cats', icon: '◈' },
  { href: '/memberships', label: 'Memberships', icon: '◆' },
  { href: '/rooms', label: 'Rooms', icon: '▦' },
  { href: '/incidents', label: 'Incidents', icon: '⚠' },
  { href: '/revenue', label: 'Revenue', icon: '◐' },
  { href: '/whatsapp', label: 'WhatsApp', icon: '◎' },
  { href: '/academy', label: 'Academy', icon: '◑' },
]

export function Nav() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

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

      <nav className="flex-1 py-3 space-y-0.5">
        {links.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 text-sm rounded mx-1 transition-all"
              style={active
                ? { background: '#B14919', color: '#ECDBB6', fontWeight: 600 }
                : { color: 'rgba(236,219,182,0.65)' }
              }
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#ECDBB6' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(236,219,182,0.65)' }}
            >
              <span className="text-sm w-4 text-center">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(236,219,182,0.15)' }}>
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
