import { requireManager, hashPassword } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { STAFF_ROLE_LABELS } from '@/lib/constants'
import { listRoles } from '@/lib/roles-store'
import { SEGMENTS } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireManager()
  const { err } = await searchParams
  const [staff, allRoles] = await Promise.all([
    db.staff.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    listRoles(),
  ])
  // Assignable roles come from what the owner defined. Manager is offered too —
  // it is a real role someone can hold — but an inactive role is not, or a new
  // hire could be put straight onto access that has been switched off.
  const roleOptions = allRoles.filter(r => r.active)
  const labelFor = new Map(allRoles.map(r => [r.key, r.label]))

  async function addStaff(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    const role = (data.get('role') as string) || 'FrontDesk'
    const pin = ((data.get('pin') as string) ?? '').trim()
    if (!name || pin.length < 4) return
    const { redirect } = await import('next/navigation')
    try {
      const created = await db.staff.create({ data: { name, role, pinHash: hashPassword(pin) } })
      await recordAudit({ action: 'staff.create', entityType: 'Staff', entityId: created.id, summary: `Added staff ${name} (${role})` })
    } catch {
      redirect('/staff?err=pin') // PIN already in use by someone else
    }
    redirect('/staff')
  }

  async function resetPin(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const pin = ((data.get('pin') as string) ?? '').trim()
    if (pin.length < 4) return
    const { redirect } = await import('next/navigation')
    try {
      await db.staff.update({ where: { id }, data: { pinHash: hashPassword(pin) } })
      const s = await db.staff.findUnique({ where: { id }, select: { name: true } })
      await recordAudit({ action: 'staff.reset_pin', entityType: 'Staff', entityId: id, summary: `Reset PIN for ${s?.name ?? id}` })
    } catch {
      redirect('/staff?err=pin')
    }
    redirect('/staff')
  }

  async function toggleActive(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const s = await db.staff.findUnique({ where: { id } })
    if (s) {
      await db.staff.update({ where: { id }, data: { active: !s.active } })
      await recordAudit({ action: 'staff.toggle_active', entityType: 'Staff', entityId: id, summary: `${s.active ? 'Disabled' : 'Enabled'} staff ${s.name}` })
    }
    revalidatePath('/staff')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Staff</h1>
        <p className="text-sm cd-muted">
          Each person logs in with their own PIN on the normal login screen. Managers see everything;
          other roles get the staff view (board, run sheet, bookings — no finances).
        </p>
      </div>

      {err === 'pin' && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
          That PIN is already used by another staff member — pick a different one.
        </div>
      )}

      {/* Add staff */}
      <form action={addStaff} className="cd-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="cd-label">Name</label>
          <input name="name" required className="cd-input" style={{ width: '11rem' }} placeholder="e.g. Aina" />
        </div>
        <div>
          <label className="cd-label">Role</label>
          <select name="role" className="cd-input" style={{ width: '10rem' }}>
            {roleOptions.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">PIN (min 4 digits)</label>
          <input name="pin" required minLength={4} className="cd-input" style={{ width: '8rem' }} placeholder="e.g. 4821" />
        </div>
        <SubmitButton className="cd-btn" busyLabel="Working…">Add staff</SubmitButton>
      </form>

      {/* Staff list */}
      <div className="cd-card overflow-hidden">
        {staff.length === 0 ? (
          <p className="px-4 py-8 text-sm cd-muted text-center">No staff yet — add your team above. They log in with their PIN.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="cd-thead">
                <th>Name</th><th>Role</th><th>Status</th><th>Reset PIN</th><th></th>
              </tr></thead>
              <tbody className="cd-tbody">
                {staff.map(s => (
                  <tr key={s.id} style={s.active ? undefined : { opacity: 0.5 }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>{s.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="cd-pill" style={s.role === 'Manager'
                        ? { background: SEGMENTS.business.bg, color: SEGMENTS.business.text }
                        : s.role === 'Groomer'
                        ? { background: SEGMENTS.grooming.bg, color: SEGMENTS.grooming.text }
                        : s.role === 'Boarding'
                        ? { background: SEGMENTS.boarding.bg, color: SEGMENTS.boarding.text }
                        : { background: SEGMENTS.community.bg, color: SEGMENTS.community.text }}>
                        {labelFor.get(s.role) ?? STAFF_ROLE_LABELS[s.role] ?? s.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 cd-muted">{s.active ? 'Active' : 'Disabled'}</td>
                    <td className="px-4 py-2.5">
                      <form action={resetPin} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={s.id} />
                        <input name="pin" minLength={4} className="cd-input" style={{ width: '6.5rem' }} placeholder="New PIN" />
                        <SubmitButton className="cd-btn-sec text-xs" busyLabel="Working…">Set</SubmitButton>
                      </form>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <form action={toggleActive}>
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton className="text-xs cd-link" busyLabel="…">{s.active ? 'Disable' : 'Enable'}</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
