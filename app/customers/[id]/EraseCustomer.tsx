'use client'
import { useState } from 'react'

// Manager-only erasure control (A3). Posts to the erase API route (a plain form
// POST so it works without extra JS wiring); a confirm() guard and a two-step
// reveal keep it from being triggered by accident. Irreversible.
export function EraseCustomer({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cd-card p-4" style={{ borderLeft: '3px solid #B14919' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: '#B14919' }}>Erase customer (right to be forgotten)</div>
          <p className="text-xs cd-muted mt-0.5 max-w-xl">
            Redacts name, contact details, notes and pet health notes, and deletes all photos.
            De-identified financial records are kept for the retention window, then purged
            automatically. This cannot be undone.
          </p>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="cd-btn-sec text-xs whitespace-nowrap"
            style={{ color: '#B14919', borderColor: 'rgba(177,73,25,0.5)' }}>Erase…</button>
        )}
      </div>
      {open && (
        <form method="POST" action={`/api/customers/${id}/erase`} className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={e => { if (!confirm(`Permanently anonymise ${name}? Identifying data and photos will be removed. This cannot be undone.`)) e.preventDefault() }}>
          <span className="text-xs cd-muted">Confirm erasure of <strong>{name}</strong>:</span>
          <button type="submit" className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: '#B14919', color: '#F2EDE0' }}>Erase permanently</button>
          <button type="button" onClick={() => setOpen(false)} className="cd-btn-sec text-xs">Cancel</button>
        </form>
      )}
    </div>
  )
}
