'use client'

import { useState } from 'react'
import { POINTS_REASONS } from '@/lib/constants'
import { SubmitButton } from '@/app/components/Pending'

export function AwardPointsForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [points, setPoints] = useState(POINTS_REASONS[0].points)

  return (
    <form action={action} className="space-y-2">
      <select
        name="reason"
        defaultValue={POINTS_REASONS[0].reason}
        onChange={e => {
          const r = POINTS_REASONS.find(x => x.reason === e.target.value)
          if (r) setPoints(r.points)
        }}
        className="cd-input"
      >
        {POINTS_REASONS.map(r => (
          <option key={r.reason} value={r.reason}>
            {r.label}{r.points ? ` (+${r.points})` : ''}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          name="points"
          type="number"
          value={points}
          onChange={e => setPoints(parseInt(e.target.value || '0', 10))}
          className="cd-input"
          style={{ width: '6rem' }}
        />
        <input name="note" placeholder="Note (optional)" className="cd-input flex-1" />
      </div>
      <SubmitButton className="cd-btn w-full text-center" busyLabel="Working…">Award Points</SubmitButton>
      <p className="text-xs cd-muted">Tip: enter a negative number to redeem points.</p>
    </form>
  )
}
