'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/report-error'

// Friendly branded error boundary — replaces the raw "server error" screen.
// Most sightings are a stale tab submitting across a deploy; retry fixes it.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error) }, [error])
  return (
    <div className="flex items-center justify-center" style={{ minHeight: '70vh' }}>
      <div className="cd-card p-8 text-center max-w-md space-y-3">
        <div className="text-3xl">🙀</div>
        <h2 className="font-bold text-lg" style={{ color: '#2D1907' }}>Something went wrong</h2>
        <p className="text-sm cd-muted">
          Usually this just means the app was updated while this tab was open —
          your work is most likely saved. Refreshing the page fixes it.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button onClick={() => window.location.reload()} className="cd-btn text-sm">Refresh page</button>
          <button onClick={() => reset()} className="cd-btn-sec text-sm">Try again</button>
        </div>
      </div>
    </div>
  )
}
