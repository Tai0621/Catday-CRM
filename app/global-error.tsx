'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/report-error'

// Last-resort boundary for errors thrown in the root layout itself. It replaces
// the whole document, so it can't rely on globals.css/Tailwind — styles inline,
// in brand colours.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error) }, [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F2EDE0', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#2D1907' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: 32 }}>🙀</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0.75rem 0 0.5rem' }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: 'rgba(45,25,7,0.6)', margin: '0 0 1.25rem' }}>
            The app hit an unexpected error. Refreshing usually fixes it — your data is safe.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => window.location.reload()}
              style={{ background: '#B14919', color: '#F7F0E1', border: 'none', borderRadius: 12, padding: '0.65rem 1.1rem', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Refresh page
            </button>
            <button onClick={() => reset()}
              style={{ background: 'transparent', color: '#2D1907', border: '1px solid rgba(45,25,7,0.2)', borderRadius: 12, padding: '0.65rem 1.1rem', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
