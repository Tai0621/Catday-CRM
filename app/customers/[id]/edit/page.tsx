import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { normalisePhone } from '@/lib/phone'
import { CUSTOMER_SOURCES, CUSTOMER_LANGUAGES } from '@/lib/constants'
import { consentUpdate } from '@/lib/consent'
import { SubmitButton } from '@/app/components/Pending'

export default async function EditCustomerPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}) {
  await requireAuth()
  const { id } = await params
  const { err } = await searchParams
  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) notFound()

  async function save(data: FormData) {
    'use server'
    const phone = normalisePhone(data.get('phone') as string)
    if (!phone) redirect(`/customers/${id}/edit?err=phone`)
    try {
      await db.customer.update({
        where: { id },
        data: {
          phone,
          name: ((data.get('name') as string) || '').trim() || null,
          email: ((data.get('email') as string) || '').trim() || null,
          address: ((data.get('address') as string) || '').trim() || null,
          source: (data.get('source') as string) || 'WalkIn',
          // M9 · blank means unknown, which the OS treats as the business default
          // rather than assuming English.
          language: ((data.get('language') as string) || '').trim() || null,
          ...consentUpdate(data.get('marketingConsent') === 'on', 'Staff', customer),
          notes: ((data.get('notes') as string) || '').trim() || null,
        },
      })
    } catch {
      redirect(`/customers/${id}/edit?err=phone-taken`) // unique phone clash
    }
    redirect(`/customers/${id}`)
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/customers/${id}`} className="text-xs cd-muted hover:underline">{customer.name ?? customer.phone}</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Edit</span>
        </div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Edit Customer</h1>
      </div>

      {err === 'phone' && <Notice>Phone number can’t be empty.</Notice>}
      {err === 'phone-taken' && <Notice>Another customer already uses that phone number.</Notice>}

      <form action={save} className="cd-card p-5 space-y-4">
        <div>
          <label className="cd-label">Phone *</label>
          <input name="phone" type="tel" required defaultValue={customer.phone} className="cd-input" />
        </div>
        <div>
          <label className="cd-label">Name</label>
          <input name="name" defaultValue={customer.name ?? ''} placeholder="Full name" className="cd-input" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Email</label>
            <input name="email" type="email" defaultValue={customer.email ?? ''} placeholder="email@example.com" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Source</label>
            <select name="source" defaultValue={customer.source} className="cd-input">
              {CUSTOMER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="cd-label">
            Language <span className="cd-muted font-normal">· what we write to them in</span>
          </label>
          <select name="language" defaultValue={customer.language ?? ''} className="cd-input">
            <option value="">Not known — use the business default</option>
            {CUSTOMER_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Address</label>
          <input name="address" defaultValue={customer.address ?? ''} placeholder="Home address" className="cd-input" />
        </div>
        <div>
          <label className="cd-label">Notes</label>
          <textarea name="notes" rows={2} defaultValue={customer.notes ?? ''} placeholder="Any special notes…" className="cd-input" />
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#2D1907' }}>
          <input type="checkbox" name="marketingConsent" defaultChecked={customer.marketingConsent} />
          Marketing consent given
        </label>
        <div className="flex gap-3 pt-1">
          <SubmitButton className="cd-btn" busyLabel="Working…">Save changes</SubmitButton>
          <Link href={`/customers/${id}`} className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 text-sm"
      style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
      {children}
    </div>
  )
}
