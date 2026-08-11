'use client'

import { useState } from 'react'
import { CUSTOMER_SOURCES } from '@/lib/constants'
import { createCustomerWithCat } from './actions'

interface CustomerOpt { id: string; name: string | null; phone: string }
interface CatOpt { id: string; name: string; customerId: string }

const INK = '#2D1907'
const ACCENT = '#B14919'

/**
 * Register a first-time customer without leaving the booking.
 *
 * Deliberately the SHORT version of the customer form — phone, name, one cat.
 * Address, notes and the rest are asked for on the customer record later; a
 * counter with a cat on it is the worst possible moment to demand them, and a
 * long form here is what pushes staff into booking everything under a single
 * "walk-in" account.
 */
export function NewCustomerPanel({
  onCreated, onCancel,
}: {
  onCreated: (customer: CustomerOpt, cat: CatOpt, existing: boolean) => void
  onCancel: () => void
}) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('WalkIn')
  const [consent, setConsent] = useState(false)
  const [catName, setCatName] = useState('')
  const [breed, setBreed] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = phone.trim().length > 0 && catName.trim().length > 0

  async function save() {
    setBusy(true); setError(null)
    const res = await createCustomerWithCat(JSON.stringify({
      phone, name, email, source, marketingConsent: consent, catName, breed,
    }))
    if (res.ok) onCreated(res.customer, res.cat, res.existing)
    else { setError(res.error); setBusy(false) }
  }

  return (
    <div className="rounded-xl p-4 space-y-3"
      style={{ background: 'rgba(177,73,25,0.06)', border: '1px solid rgba(177,73,25,0.25)' }}>
      <p className="text-xs" style={{ color: INK }}>
        <strong>New customer.</strong> Just enough to take the booking — the rest can be filled in on
        their record later.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone *" value={phone} onChange={setPhone} type="tel" placeholder="012-3456789" />
        <Field label="Name" value={name} onChange={setName} placeholder="Full name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cat's name *" value={catName} onChange={setCatName} placeholder="e.g. Mochi" />
        <Field label="Breed" value={breed} onChange={setBreed} placeholder="e.g. Persian" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="optional" />
        <div>
          <label className="cd-label">Source</label>
          <select value={source} onChange={e => setSource(e.target.value)} className="cd-input">
            {CUSTOMER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: INK }}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="rounded" />
        Happy to receive offers and reminders
      </label>

      {error && (
        <p className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(177,73,25,0.12)', color: ACCENT }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!ready || busy} className="cd-btn text-sm"
          style={!ready || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Adding…' : 'Add & select'}
        </button>
        <button type="button" onClick={onCancel} className="cd-btn-sec text-sm">Cancel</button>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="cd-label">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className="cd-input" />
    </div>
  )
}
