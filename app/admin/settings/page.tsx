import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { SETTING_FIELDS, defaultFor } from '@/lib/config'
import { SEGMENTS } from '@/lib/segments'
import { PRODUCT_RELEASE } from '@/lib/version'

// Business Settings — the config seam. Editing these changes the app's
// identity, currency, tax and operating hours without touching code. Blank a
// field to fall back to the built-in default. Manager-only.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireManager()
  const { saved } = await searchParams

  const rows = await db.setting.findMany()
  const current = new Map(rows.map(r => [r.key, r.value]))

  async function save(data: FormData) {
    'use server'
    const ops = []
    for (const field of SETTING_FIELDS) {
      const raw = ((data.get(field.key) as string) ?? '').trim()
      if (raw === '') {
        ops.push(db.setting.deleteMany({ where: { key: field.key } })) // cleared → back to default
      } else {
        ops.push(db.setting.upsert({
          where: { key: field.key },
          create: { key: field.key, value: raw },
          update: { value: raw },
        }))
      }
    }
    await db.$transaction(ops)
    // Config feeds almost everything — refresh the surfaces that read it now
    revalidatePath('/', 'layout')
    redirect('/admin/settings?saved=1')
  }

  // group fields for the form
  const groups: { title: string; fields: typeof SETTING_FIELDS }[] = []
  for (const f of SETTING_FIELDS) {
    let g = groups.find(x => x.title === f.group)
    if (!g) { g = { title: f.group, fields: [] }; groups.push(g) }
    g.fields.push(f)
  }
  const seg = SEGMENTS.business

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Business Settings
        </h1>
        <p className="text-sm cd-muted">Your business identity, currency, tax and operating hours. Leave a field blank to use the built-in default.</p>
      </div>

      {saved && (
        <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(122,138,79,0.15)', border: '1px solid rgba(122,138,79,0.35)', color: '#5c6b3c' }}>
          ✓ Settings saved.
        </div>
      )}

      <form action={save} className="space-y-5">
        {groups.map(group => (
          <div key={group.title} className="cd-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: seg.text, letterSpacing: '0.08em' }}>{group.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {group.fields.map(f => (
                <div key={f.key} className={f.key === 'business.address' ? 'sm:col-span-2' : ''}>
                  <label className="cd-label">{f.label}{f.hint && <span className="cd-muted font-normal"> · {f.hint}</span>}</label>
                  {f.kind === 'bool' ? (
                    // Stored as the words 'yes'/'no' so a Setting row read by eye
                    // still says what it means.
                    <select name={f.key} defaultValue={current.get(f.key) ?? defaultFor(f.key)} className="cd-input">
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  ) : (
                    <input
                      name={f.key}
                      type={f.kind === 'number' ? 'number' : 'text'}
                      step={f.kind === 'number' ? 'any' : undefined}
                      defaultValue={current.get(f.key) ?? ''}
                      placeholder={defaultFor(f.key) || '—'}
                      className="cd-input"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button type="submit" className="cd-btn">Save settings</button>
          <span className="text-xs cd-muted">Changes take effect immediately across the app.</span>
        </div>
      </form>

      <p className="text-xs cd-muted">
        Currency, locale and timezone prepare the system to run for a business in any country. Timezone-accurate
        scheduling and non-Malaysia tax rules arrive in a later round; for now they hold the values the app displays.
      </p>

      <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid rgba(45,25,7,0.1)' }}>
        <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>
          {PRODUCT_RELEASE}
        </span>
        <span className="text-xs cd-muted">Quote this version when reporting a problem.</span>
      </div>
    </div>
  )
}
