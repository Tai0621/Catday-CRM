import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { VARIANT_TESTABLE_TYPES, CUSTOMER_LANGUAGES, type ActionType } from '@/lib/constants'
import { buildVariantStats, recommendedWinner, type VariantStats } from '@/lib/actions-learning'
import { buildAttribution, type VariantRevenue } from '@/lib/attribution'
import { getConfig, fmtMoney, type AppConfig } from '@/lib/config'
import { SEGMENTS, ACTION_SEGMENT } from '@/lib/segments'
import { SubmitButton } from '@/app/components/Pending'

// C4 · Message variants. Every win-back message this business sent was the same
// sentence and nobody knew whether it worked. Competing copy is assigned
// deterministically by customer and scored on the same conversion definition the
// action type itself is judged by.
//
// Promotion is a manager's click, never automatic: this is copy a customer
// reads, and the house rule is that the system proposes while a person confirms.

const typeLabel = (t: string) =>
  t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+(\w)/g, (_, c: string) => ` ${c.toLowerCase()}`)
const pct = (n: number) => `${Math.round(n * 100)}%`

export default async function VariantsPage() {
  await requireManager()

  const types = VARIANT_TESTABLE_TYPES as readonly ActionType[]
  const [rows, statsByType, attribution, cfg] = await Promise.all([
    db.actionVariant.findMany({ orderBy: [{ type: 'asc' }, { label: 'asc' }] }),
    Promise.all(types.map(t => buildVariantStats(t))).then(list => new Map(types.map((t, i) => [t, list[i]]))),
    buildAttribution(),
    getConfig(),
  ])

  async function addVariant(data: FormData) {
    'use server'
    await requireManager()
    const type = String(data.get('type') ?? '')
    const label = String(data.get('label') ?? '').trim().slice(0, 40)
    const body = String(data.get('body') ?? '').trim().slice(0, 600)
    if (!(VARIANT_TESTABLE_TYPES as readonly string[]).includes(type) || !label || !body) return
    // M9 · blank stays null, meaning language-neutral and eligible for anyone.
    const raw = String(data.get('language') ?? '')
    const language = (CUSTOMER_LANGUAGES as readonly string[]).includes(raw) ? raw : null
    await db.actionVariant.upsert({
      where: { type_label: { type, label } },
      create: { type, label, body, language },
      update: { body, language, isActive: true },
    })
    revalidatePath('/admin/variants')
  }

  async function setActive(data: FormData) {
    'use server'
    await requireManager()
    const id = String(data.get('id') ?? '')
    const active = data.get('active') === 'true'
    if (!id) return
    await db.actionVariant.update({ where: { id }, data: { isActive: active } })
    revalidatePath('/admin/variants')
  }

  // Promoting retires the losing arms and leaves the winner as the only copy in
  // rotation. The test reopens when a manager adds a new challenger — that is
  // the "keep a challenger slot open" half, and it stays a deliberate act.
  async function promote(data: FormData) {
    'use server'
    await requireManager()
    const id = String(data.get('id') ?? '')
    const type = String(data.get('type') ?? '')
    if (!id || !type) return
    await db.$transaction([
      db.actionVariant.updateMany({ where: { type }, data: { isDefault: false, isActive: false } }),
      db.actionVariant.update({ where: { id }, data: { isDefault: true, isActive: true } }),
    ])
    revalidatePath('/admin/variants')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Message variants</h1>
        <p className="text-sm cd-muted">
          Competing copy for the outbound nudges. Each customer always sees the same version, so the
          comparison stays honest. A variant is judged on whether a booking actually followed — not on
          how it reads.
        </p>
      </div>

      {types.map(type => {
        const seg = SEGMENTS[ACTION_SEGMENT[type]]
        const mine = rows.filter(r => r.type === type)
        const stats = statsByType.get(type) ?? []
        const statBy = new Map(stats.map(s => [s.label, s]))
        const winner = recommendedWinner(stats)

        return (
          <section key={type} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
              <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{typeLabel(type)}</h2>
              <span className="cd-pill" style={{ background: seg.bg, color: seg.text }}>
                {mine.filter(m => m.isActive).length} in rotation
              </span>
            </div>

            {mine.length === 0 && (
              <p className="text-xs cd-muted">
                No variants — this nudge uses its built-in message. Add a second version to start testing.
              </p>
            )}

            {mine.map(v => {
              const s = statBy.get(v.label)
              const isWinner = winner?.label === v.label
              return (
                <div key={v.id} className="cd-card p-3 space-y-2"
                  style={{ borderLeft: `3px solid ${v.isActive ? seg.color : 'rgba(45,25,7,0.15)'}` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>{v.label}</span>
                    {v.isDefault && <span className="cd-pill" style={{ background: seg.bg, color: seg.text }}>promoted</span>}
                    {!v.isActive && <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' }}>retired</span>}
                    <span className="flex-1" />
                    <VariantNumbers s={s} money={attribution.byVariant.get(v.label)} cfg={cfg} />
                  </div>

                  <p className="text-xs" style={{ color: 'rgba(45,25,7,0.7)' }}>{v.body}</p>

                  <div className="flex items-center gap-2">
                    <form action={setActive}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="active" value={String(!v.isActive)} />
                      <SubmitButton className="text-xs px-2.5 py-1 rounded-lg cd-btn-sec" busyLabel="Working…">
                        {v.isActive ? 'Retire' : 'Put back in rotation'}
                      </SubmitButton>
                    </form>
                    {isWinner && (
                      <form action={promote}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="type" value={type} />
                        <SubmitButton className="text-xs px-2.5 py-1 rounded-lg font-medium"
                          style={{ background: seg.color, color: '#F2EDE0' }} busyLabel="Working…">Promote — best converting</SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              )
            })}

            {stats.length > 0 && !winner && (
              <p className="text-xs cd-muted">
                Still running — no arm has both enough closed conversion windows and a clear enough lead to call.
              </p>
            )}

            <details className="cd-card p-3">
              <summary className="cursor-pointer text-xs font-medium" style={{ color: '#2D1907' }}>Add a version</summary>
              <form action={addVariant} className="mt-3 space-y-2">
                <input type="hidden" name="type" value={type} />
                <div>
                  <label className="cd-label">Name</label>
                  <input name="label" className="cd-input" placeholder="e.g. Warm / Direct / Offer-led" required maxLength={40} />
                </div>
                <div>
                  <label className="cd-label">
                    Message <span className="cd-muted font-normal">· {'{cat}'} {'{brand}'} {'{customer}'} {'{days}'} are filled in per customer</span>
                  </label>
                  <input name="body" className="cd-input" placeholder="Hi! {cat} is due for a groom…" required maxLength={600} />
                </div>
                <div>
                  <label className="cd-label">
                    Language <span className="cd-muted font-normal">· who this wording is for</span>
                  </label>
                  <select name="language" className="cd-input" defaultValue="">
                    <option value="">Any language</option>
                    {CUSTOMER_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <p className="text-xs cd-muted mt-1">
                    A customer recorded as speaking this language sees only versions written in it, and those
                    versions still compete with each other — so copy testing and localisation do not fight.
                  </p>
                </div>
                <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Add version</SubmitButton>
              </form>
            </details>
          </section>
        )
      })}
    </div>
  )
}

function VariantNumbers({ s, money, cfg }: {
  s: VariantStats | undefined
  money: VariantRevenue | undefined
  cfg: AppConfig
}) {
  if (!s || s.sent === 0) return <span className="text-xs cd-muted">not sent yet</span>
  return (
    <span className="text-xs cd-muted flex items-center gap-2">
      {money && money.attributedRM > 0 && (
        // Revenue per send is the number that actually decides between two arms:
        // a variant can convert more often and still be worth less per message.
        <span className="font-semibold" style={{ color: '#2D1907' }}>
          {fmtMoney(money.perSendRM, cfg, { decimals: 2 })}/send
        </span>
      )}
      <span style={{ color: s.measured ? '#2D1907' : undefined, fontWeight: s.measured ? 600 : undefined }}>
        {s.eligible > 0 ? `${pct(s.conversionRate)} booked` : 'window still open'}
      </span>
      <span>{pct(s.acceptance)} actioned</span>
      <span>sent {s.sent}</span>
    </span>
  )
}
