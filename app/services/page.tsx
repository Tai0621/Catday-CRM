import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { SERVICE_CATEGORIES } from '@/lib/constants'
import { apptTypeStyle } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

// The service menu is the single source of truth for prices and durations —
// bookings, the slot engine and billing all read from here.
export default async function ServicesPage() {
  await requireManager()
  const services = await db.service.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }] })

  async function addService(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    if (!name) return
    await db.service.create({
      data: {
        name,
        category: (data.get('category') as string) || 'Grooming',
        durationMin: parseInt((data.get('durationMin') as string) || '60', 10),
        price: parseFloat((data.get('price') as string) || '0'),
        sortOrder: services.length + 1,
      },
    }).catch(() => {}) // duplicate name — ignore
    revalidatePath('/services')
  }

  async function updateService(data: FormData) {
    'use server'
    const id = data.get('id') as string
    await db.service.update({
      where: { id },
      data: {
        durationMin: parseInt((data.get('durationMin') as string) || '60', 10),
        price: parseFloat((data.get('price') as string) || '0'),
      },
    })
    revalidatePath('/services')
  }

  async function toggleService(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const s = await db.service.findUnique({ where: { id } })
    if (s) await db.service.update({ where: { id }, data: { active: !s.active } })
    revalidatePath('/services')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Service Menu</h1>
        <p className="text-sm cd-muted">
          Prices and durations here drive bookings, open-slot calculation and billing.
          Durations only matter for grooming-side services; boarding prices are per night.
        </p>
      </div>

      <form action={addService} className="cd-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1" style={{ minWidth: '12rem' }}>
          <label className="cd-label">Service name</label>
          <input name="name" required className="cd-input" placeholder="e.g. Kitten Intro Groom" />
        </div>
        <div>
          <label className="cd-label">Category</label>
          <select name="category" className="cd-input" style={{ width: '9rem' }}>
            {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Duration (min)</label>
          <input name="durationMin" type="number" min="0" step="15" defaultValue="60" className="cd-input" style={{ width: '6rem' }} />
        </div>
        <div>
          <label className="cd-label">Price (RM)</label>
          <input name="price" type="number" min="0" step="1" defaultValue="100" className="cd-input" style={{ width: '6rem' }} />
        </div>
        <SubmitButton className="cd-btn" busyLabel="Working…">Add</SubmitButton>
      </form>

      <div className="cd-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Service</th><th>Category</th><th>Duration</th><th>Price</th><th></th><th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {services.map(s => (
                <tr key={s.id} style={s.active ? undefined : { opacity: 0.45 }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: '#2D1907' }}>{s.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="cd-pill" style={apptTypeStyle(s.category)}>{s.category}</span>
                  </td>
                  <td className="px-4 py-2.5" colSpan={2}>
                    <form action={updateService} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={s.id} />
                      <input name="durationMin" type="number" min="0" step="15" defaultValue={s.durationMin} className="cd-input" style={{ width: '5rem' }} />
                      <span className="cd-muted text-xs">min · RM</span>
                      <input name="price" type="number" min="0" step="1" defaultValue={s.price} className="cd-input" style={{ width: '5.5rem' }} />
                      <SubmitButton className="cd-btn-sec text-xs" busyLabel="Working…">Save</SubmitButton>
                    </form>
                  </td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={toggleService}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton className="text-xs cd-link" busyLabel="…">{s.active ? 'Retire' : 'Restore'}</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
