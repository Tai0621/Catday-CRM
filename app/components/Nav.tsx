'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const links = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/appointments', label: 'Appointments', icon: '📅' },
  { href: '/customers', label: 'Customers', icon: '👤' },
  { href: '/cats', label: 'Cats', icon: '🐱' },
  { href: '/memberships', label: 'Memberships', icon: '⭐' },
  { href: '/rooms', label: 'Rooms', icon: '🏠' },
  { href: '/revenue', label: 'Revenue', icon: '💰' },
  { href: '/whatsapp', label: 'WhatsApp', icon: '💬' },
  { href: '/academy', label: 'Academy', icon: '🎓' },
]

export function Nav() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside className={`flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${collapsed ? 'w-14' : 'w-52'}`}>
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-100">
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight text-rose-600">Catday</span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 ml-auto"
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>
      <nav className="flex-1 py-3 space-y-0.5">
        {links.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm rounded mx-1 transition-colors ${
                active
                  ? 'bg-rose-50 text-rose-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="text-base">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-gray-100 px-3 py-3">
        <form action="/api/logout" method="POST">
          <button
            type="submit"
            className={`flex items-center gap-2 text-xs text-gray-400 hover:text-gray-700 w-full ${collapsed ? 'justify-center' : ''}`}
          >
            <span>↩</span>
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </aside>
  )
}
