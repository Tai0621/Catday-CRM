import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { LICENSE_CATEGORIES, LICENSE_DEFAULT_REMINDER_DAYS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton, ConfirmSubmit } from '@/app/components/Pending'

// Licenses & Renewals (Administrative). Compliance items with an expiry; each
// surfaces in the Action Inbox `reminderDays` ahead of its renewal date.
// Renewing = pushing the renewal date forward. Manager-only.

const DAY = 24 * 60 * 60 * 1000
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const plusYear = (d: Date) => { const n = new Date(d); n.setFullYear(n.getFullYear() + 1); return n }
const fmt = (d: Date) => d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })

export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireManager()
  const { saved, error } = await searchParams
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [active, archived] = await Promise.all([
    db.license.findMany({ where: { archived: false }, orderBy: { renewalDate: 'asc' } }),
    db.license.findMany({ where: { archived: true }, orderBy: { renewalDate: 'desc' } }),
  ])

  async function add(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    const category = ((data.get('category') as string) ?? '').trim()
    const authority = ((data.get('authority') as string) ?? '').trim() || null
    const licenseNo = ((data.get('licenseNo') as string) ?? '').trim() || null
    const notes = ((data.get('notes') as string) ?? '').trim() || null
    const reminderDays = Math.round(Number(data.get('reminderDays'))) || LICENSE_DEFAULT_REMINDER_DAYS
    const costRaw = (data.get('cost') as string) ?? ''
    const cost = costRaw.trim() === '' ? null : Number(costRaw)
    const renewalRaw = ((data.get('renewalDate') as string) ?? '').trim()
    const issueRaw = ((data.get('issueDate') as string) ?? '').trim()

    const fail = (msg: string) => redirect(`/admin/licenses?error=${encodeURIComponent(msg)}`)
    if (!name) return fail('Name is required')
    if (!(LICENSE_CATEGORIES as readonly string[]).includes(category)) return fail('Pick a category')
    const renewalDate = new Date(`${renewalRaw}T00:00:00`)
    if (isNaN(renewalDate.getTime())) return fail('Enter a valid renewal date')
    const issueDate = issueRaw ? new Date(`${issueRaw}T00:00:00`) : null
    if (cost != null && (isNaN(cost) || cost < 0)) return fail('Cost must be 0 or more')
    if (reminderDays < 1) return fail('Reminder lead time must be at least 1 day')

    await db.license.create({
      data: { name, category, authority, licenseNo, issueDate, renewalDate, reminderDays, cost, notes },
    })
    revalidatePath('/', 'layout') // action inbox reads licences
    redirect('/admin/licenses?saved=added')
  }

  async function renew(data: FormData) {
    'use server'
    const id = (data.get('id') as string) ?? ''
    const dateRaw = ((data.get('renewalDate') as string) ?? '').trim()
    const renewalDate = new Date(`${dateRaw}T00:00:00`)
    if (!id || isNaN(renewalDate.getTime())) redirect('/admin/licenses?error=Enter a valid new renewal date')
    await db.license.update({ where: { id }, data: { renewalDate } })
    revalidatePath('/', 'layout')
    redirect('/admin/licenses?saved=renewed')
  }

  async function setArchived(data: FormData) {
    'use server'
    const id = (data.get('id') as string) ?? ''
    const archived = data.get('archived') === '1'
    if (id) {
      await db.license.update({ where: { id }, data: { archived } })
      revalidatePath('/', 'layout')
    }
    redirect(`/admin/licenses?saved=${archived ? 'archived' : 'restored'}`)
  }

  async function remove(data: FormData) {
    'use server'
    const id = (data.get('id') as string) ?? ''
    if (id) { await db.license.delete({ where: { id } }); revalidatePath('/', 'layout') }
    redirect('/admin/licenses?saved=removed')
  }

  const seg = SEGMENTS.business
  const savedMsg: Record<string, string> = {
    added: 'Licence added.', renewed: 'Renewal date updated.', archived: 'Licence archived.',
    restored: 'Licence restored.', removed: 'Licence removed.',
  }

  const statusOf = (renewalDate: Date, reminderDays: number) => {
    const daysLeft = Math.floor((renewalDate.getTime() - todayStart.getTime()) / DAY)
    if (daysLeft < 0) return { label: `Overdue ${Math.abs(daysLeft)}d`, color: '#B14919', due: true }
    if (daysLeft <= reminderDays) return { label: `Due in ${daysLeft}d`, color: '#B8902B', due: true }
    return { label: `${daysLeft}d left`, color: 'rgba(45,25,7,0.5)', due: false }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Licenses &amp; Renewals
        </h1>
        <p className="text-sm cd-muted">
          Business permits, insurance and certifications with an expiry. Each surfaces in the{' '}
          <span className="font-medium">Action Inbox</span> ahead of its renewal date, so nothing lapses. Renewing pushes the date forward.
        </p>
      </div>

      {saved && (
        <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(122,138,79,0.15)', border: '1px solid rgba(122,138,79,0.35)', color: '#5c6b3c' }}>
          ✓ {savedMsg[saved] ?? 'Saved.'}
        </div>
      )}
      {error && (
        <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.35)', color: '#B14919' }}>
          {error}
        </div>
      )}

      {/* Active licences */}
      <div className="cd-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="cd-thead">
            <tr>
              <th className="text-left px-4 py-2.5">Licence / permit</th>
              <th className="text-left px-4 py-2.5">Authority</th>
              <th className="text-left px-4 py-2.5">Renewal due</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Mark renewed</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {active.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center cd-muted">No licences tracked yet. Add one below to start getting renewal reminders.</td></tr>
            )}
            {active.map(l => {
              const st = statusOf(l.renewalDate, l.reminderDays)
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium" style={{ color: '#2D1907' }}>{l.name}</div>
                    <div className="text-xs cd-muted">{l.category}{l.licenseNo ? ` · ${l.licenseNo}` : ''}{l.notes ? ` · ${l.notes}` : ''}</div>
                  </td>
                  <td className="px-4 py-2.5 cd-muted">{l.authority ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: '#2D1907' }}>{fmt(l.renewalDate)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="cd-pill" style={{ color: st.color, borderColor: st.color, background: st.due ? `${st.color}14` : 'transparent' }}>{st.label}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <form action={renew} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="date" name="renewalDate" defaultValue={isoDay(plusYear(l.renewalDate))} className="cd-input !py-1 !w-auto text-xs" />
                      <SubmitButton className="text-xs cd-btn-sec !py-1 !px-2" busyLabel="Working…">Renew</SubmitButton>
                    </form>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <form action={setArchived} className="inline">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="archived" value="1" />
                      <SubmitButton className="text-xs cd-link" busyLabel="Working…">Archive</SubmitButton>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add licence */}
      <form action={add} className="cd-card p-5 space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: seg.text, letterSpacing: '0.08em' }}>Add a licence</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="cd-label">Name</label>
            <input name="name" className="cd-input" placeholder="e.g. Business Premise Licence" required />
          </div>
          <div>
            <label className="cd-label">Category</label>
            <select name="category" className="cd-input" defaultValue="Business Licence">
              {LICENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Issuing authority <span className="cd-muted font-normal">· optional</span></label>
            <input name="authority" className="cd-input" placeholder="e.g. DBKL, Bomba" />
          </div>
          <div>
            <label className="cd-label">Renewal due date</label>
            <input name="renewalDate" type="date" className="cd-input" required />
          </div>
          <div>
            <label className="cd-label">Remind me <span className="cd-muted font-normal">· days ahead</span></label>
            <input name="reminderDays" type="number" step="1" min="1" className="cd-input" defaultValue={LICENSE_DEFAULT_REMINDER_DAYS} />
          </div>
          <div>
            <label className="cd-label">Licence no. <span className="cd-muted font-normal">· optional</span></label>
            <input name="licenseNo" className="cd-input" placeholder="reference / serial" />
          </div>
          <div>
            <label className="cd-label">Issue date <span className="cd-muted font-normal">· optional</span></label>
            <input name="issueDate" type="date" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Renewal fee (RM) <span className="cd-muted font-normal">· optional</span></label>
            <input name="cost" type="number" step="any" min="0" className="cd-input" placeholder="0" />
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="cd-label">Notes <span className="cd-muted font-normal">· optional</span></label>
            <input name="notes" className="cd-input" placeholder="renewal steps, contact…" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="cd-btn" busyLabel="Working…">Add licence</SubmitButton>
          <span className="text-xs cd-muted">Tip: set a longer lead time for permits that take weeks to process.</span>
        </div>
      </form>

      {/* Archived */}
      {archived.length > 0 && (
        <div className="cd-card p-5 space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider cd-muted">Archived</h2>
          <div className="space-y-2">
            {archived.map(l => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span className="cd-muted">{l.name} · {l.category} · last due {fmt(l.renewalDate)}</span>
                <span className="flex items-center gap-3">
                  <form action={setArchived} className="inline">
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="archived" value="0" />
                    <SubmitButton className="text-xs cd-link" busyLabel="Working…">Restore</SubmitButton>
                  </form>
                  <form action={remove} className="inline">
                    <input type="hidden" name="id" value={l.id} />
                    <ConfirmSubmit className="text-xs cd-link" style={{ color: '#B14919' }} busyLabel="Working…"
                      message={`Delete the licence "${l.name}"? Its renewal reminders go with it.`}>Delete</ConfirmSubmit>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
