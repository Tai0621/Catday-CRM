'use client'

import { useState } from 'react'

// Password input with a show/hide toggle. Client component so the login page
// itself can stay a server component (it redirects when already authed).
export function PasswordField() {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        name="password"
        type={show ? 'text' : 'password'}
        required
        autoFocus
        placeholder="Enter your password"
        className="w-full rounded-xl px-4 py-3 pr-11 text-sm focus:outline-none transition-shadow"
        style={{ background: '#F7F2E7', border: '1px solid rgba(45,25,7,0.18)', color: '#2D1907' }}
        onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(177,73,25,0.18)' }}
        onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors"
        style={{ color: 'rgba(45,25,7,0.5)' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#B14919' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(45,25,7,0.5)' }}
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
