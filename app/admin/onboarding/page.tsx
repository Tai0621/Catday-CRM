import { requireManager } from '@/lib/auth'
import { latestPlan, hasLiveData, DESTRUCTIVE_GROUPS, TEMPLATE_TYPES, type PlanGroup } from '@/lib/onboarding'
import { SERVICE_CATEGORIES, ROOM_TYPES, TIER_QUALIFICATIONS } from '@/lib/constants'
import { EXPENSE_CATEGORIES } from '@/lib/finance-categories'
import { SEGMENTS } from '@/lib/segments'
import { aiConfigured } from '@/lib/ai/provider'
import { generate, commit } from './actions'
import { SubmitButton } from '@/app/components/Pending'

// C6 · Generative onboarding.
//
// The screen a new client sees on day one: describe the business in a
// paragraph, get a full starting configuration, correct it, commit it group by
// group. Nothing is written until a group's own Commit is pressed.
export default async function OnboardingPage() {
  await requireManager()
  const [stored, live] = await Promise.all([latestPlan(), hasLiveData()])
  // Asks the provider seam, not one provider's env var: the demo runs on
  // Groq and would otherwise hide a working feature behind the
  // "not configured" state.
  const configured = aiConfigured()
  const seg = SEGMENTS.business

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Set up this business
        </h1>
        <p className="text-sm cd-muted">
          Describe the business in a paragraph and the OS proposes a service menu, rooms, membership
          tiers, colours, voice and message templates. Everything is editable, and nothing is saved
          until you commit that section.
        </p>
      </div>

      {live && (
        <div className="cd-card p-4" style={{ borderLeft: '3px solid #B14919' }}>
          <p className="text-sm" style={{ color: '#B14919' }}>
            <strong>This system already has live customer data.</strong> Services, rooms, tiers and
            templates are only ever <em>added</em> — an existing name is skipped, never overwritten.
            Business identity, colours and voice do replace what is there, so those need a tick before
            they will commit.
          </p>
        </div>
      )}

      {!configured ? (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            No AI provider key on this deployment, so a plan cannot be generated here.
            Configure the business by hand in <strong>Business Settings</strong>, or run onboarding on a
            deployment that has a key.
          </p>
        </div>
      ) : (
        <form action={generate} className="cd-card p-5 space-y-3">
          <div>
            <label className="cd-label">Describe the business</label>
            <textarea name="description" rows={4} className="cd-input" required minLength={20}
              placeholder="e.g. Cat grooming and boarding in Penang. 6 boarding rooms, 2 groomers. Grooms run RM80–200 depending on coat. We also sell food and litter. Open 10 to 7, closed Mondays."
              defaultValue={stored?.description ?? ''} />
            <p className="text-xs cd-muted mt-1">
              The more specific the prices, room count and opening hours, the less there is to correct.
            </p>
          </div>
          <SubmitButton className="cd-btn text-sm" busyLabel="Working…">
            {stored ? 'Generate a new plan' : 'Generate the starting configuration'}
          </SubmitButton>
        </form>
      )}

      {stored && (
        <>
          {stored.plan.notes.length > 0 && (
            <div className="cd-card p-4 space-y-1">
              <p className="cd-label">Check these — they were guessed</p>
              {stored.plan.notes.map((note, i) => (
                <p key={i} className="text-sm" style={{ color: '#2D1907' }}>— {note}</p>
              ))}
            </div>
          )}

          <Group id={stored.id} group="business" label="Business identity" done={stored.committed} live={live}
            note="Replaces what is in Business Settings.">
            <Field name="name" label="Business name" value={stored.plan.business.name} />
            <Field name="tagline" label="Tagline" value={stored.plan.business.tagline} />
            <div className="grid grid-cols-2 gap-3">
              <Field name="phone" label="Phone" value={stored.plan.business.phone} />
              <Field name="email" label="Email" value={stored.plan.business.email} />
            </div>
            <Field name="address" label="Address" value={stored.plan.business.address} />
            <div className="grid grid-cols-4 gap-3">
              <Field name="currencyCode" label="Currency" value={stored.plan.business.currencyCode} />
              <Field name="currencySymbol" label="Symbol" value={stored.plan.business.currencySymbol} />
              <Field name="locale" label="Locale" value={stored.plan.business.locale} />
              <Field name="timezone" label="Timezone" value={stored.plan.business.timezone} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field name="openHour" label="Opens (24h)" value={String(stored.plan.business.openHour)} type="number" />
              <Field name="closeHour" label="Closes (24h)" value={String(stored.plan.business.closeHour)} type="number" />
            </div>
          </Group>

          <Group id={stored.id} group="services" label={`Service menu (${stored.plan.services.length})`}
            done={stored.committed} live={live} note="Added only — an existing service name is skipped.">
            <Table head={['Service', 'Category', 'Minutes', 'Price']}>
              {stored.plan.services.map((s, i) => (
                <tr key={i}>
                  <Cell><input name="sName" defaultValue={s.name} className="cd-input w-full text-sm" /></Cell>
                  <Cell><Select name="sCategory" value={s.category} options={SERVICE_CATEGORIES} /></Cell>
                  <Cell><input name="sDuration" type="number" min="5" defaultValue={s.durationMin} className="cd-input text-sm" style={{ width: '5rem' }} /></Cell>
                  <Cell><input name="sPrice" type="number" min="0" step="0.01" defaultValue={s.price} className="cd-input text-sm" style={{ width: '6rem' }} /></Cell>
                </tr>
              ))}
            </Table>
          </Group>

          <Group id={stored.id} group="rooms" label={`Rooms (${stored.plan.rooms.length})`}
            done={stored.committed} live={live} note="Added only — an existing room name is skipped.">
            <Table head={['Room', 'Type', 'Cats']}>
              {stored.plan.rooms.map((r, i) => (
                <tr key={i}>
                  <Cell><input name="rName" defaultValue={r.name} className="cd-input w-full text-sm" /></Cell>
                  <Cell><Select name="rType" value={r.type} options={ROOM_TYPES} /></Cell>
                  <Cell><input name="rCapacity" type="number" min="1" defaultValue={r.capacity} className="cd-input text-sm" style={{ width: '4.5rem' }} /></Cell>
                </tr>
              ))}
            </Table>
          </Group>

          <Group id={stored.id} group="tiers" label={`Membership tiers (${stored.plan.tiers.length})`}
            done={stored.committed} live={live} note="Added only — an existing tier name is skipped.">
            <Table head={['Tier', 'Tagline', 'Qualifies by', 'Annual spend', 'Points ×']}>
              {stored.plan.tiers.map((t, i) => (
                <tr key={i}>
                  <Cell><input name="tName" defaultValue={t.name} className="cd-input w-full text-sm" /></Cell>
                  <Cell><input name="tTagline" defaultValue={t.tagline} className="cd-input w-full text-sm" /></Cell>
                  <Cell><Select name="tQualification" value={t.qualification} options={TIER_QUALIFICATIONS} /></Cell>
                  <Cell><input name="tThreshold" type="number" min="0" defaultValue={t.annualSpendThreshold ?? ''} className="cd-input text-sm" style={{ width: '6rem' }} /></Cell>
                  <Cell><input name="tMultiplier" type="number" min="1" step="0.1" defaultValue={t.pointsMultiplier} className="cd-input text-sm" style={{ width: '4.5rem' }} /></Cell>
                </tr>
              ))}
            </Table>
          </Group>

          <Group id={stored.id} group="brand" label="Colours" done={stored.committed} live={live}
            note="Replaces the accent and text colours app-wide.">
            <div className="grid grid-cols-2 gap-3">
              <Field name="primary" label="Accent" value={stored.plan.brand.primary} />
              <Field name="ink" label="Text" value={stored.plan.brand.ink} />
            </div>
            <div className="flex gap-2">
              <Swatch hex={stored.plan.brand.primary} label="Accent" />
              <Swatch hex={stored.plan.brand.ink} label="Text" />
            </div>
          </Group>

          <Group id={stored.id} group="voice" label="Brand voice" done={stored.committed} live={live}
            note="Replaces the voice profile every generator in the OS reads.">
            <Field name="tone" label="Tone" value={stored.plan.voice.tone} area />
            <Field name="languages" label="Languages" value={stored.plan.voice.languages} area />
            <Field name="emoji" label="Emoji policy" value={stored.plan.voice.emoji} />
            <Field name="signature" label="Signature moves" value={stored.plan.voice.signature} area />
            <Field name="avoid" label="Never say" value={stored.plan.voice.avoid} area />
          </Group>

          <Group id={stored.id} group="templates" label={`Message templates (${stored.plan.templates.length})`}
            done={stored.committed} live={live}
            note="Seeded switched off — turn them on from Message Variants once you have read them.">
            <div className="space-y-3">
              {stored.plan.templates.map((t, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex gap-2">
                    <Select name="mType" value={t.type} options={TEMPLATE_TYPES} />
                    <input name="mLabel" defaultValue={t.label} className="cd-input text-sm flex-1" />
                  </div>
                  <textarea name="mBody" defaultValue={t.body} rows={2} className="cd-input w-full text-sm" />
                </div>
              ))}
            </div>
          </Group>

          {stored.plan.expenseGuidance.length > 0 && (
            <section className="cd-card overflow-hidden">
              <div className="cd-section-header">
                <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>Where your costs go</h2>
                <span className="text-xs cd-muted">reference only</span>
              </div>
              <div className="px-5 py-4 space-y-1">
                <p className="text-xs cd-muted mb-2">
                  Expense categories are fixed — they are what the income statement has rows for. This maps
                  what you described onto them; nothing to commit.
                </p>
                {stored.plan.expenseGuidance
                  .filter(g => (EXPENSE_CATEGORIES as readonly string[]).includes(g.category))
                  .map((g, i) => (
                    <p key={i} className="text-sm" style={{ color: '#2D1907' }}>
                      <strong>{g.category}</strong> <span className="cd-muted">— {g.examples}</span>
                    </p>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Group({
  id, group, label, done, live, note, children,
}: {
  id: string; group: PlanGroup; label: string; done: PlanGroup[]; live: boolean
  note: string; children: React.ReactNode
}) {
  const committed = done.includes(group)
  const needsConfirm = DESTRUCTIVE_GROUPS.includes(group) && live
  return (
    <form action={commit} className="cd-card overflow-hidden">
      <input type="hidden" name="planId" value={id} />
      <input type="hidden" name="group" value={group} />
      <div className="cd-section-header">
        <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{label}</h2>
        {committed && <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.18)', color: '#5c6b3c' }}>committed</span>}
      </div>
      <div className="px-5 py-4 space-y-3">
        {children}
        <p className="text-xs cd-muted">{note}</p>
        <div className="flex items-center gap-3">
          <SubmitButton className="cd-btn text-sm" busyLabel="Working…">
            {committed ? 'Commit again' : 'Commit this section'}
          </SubmitButton>
          {needsConfirm && (
            <label className="text-xs flex items-center gap-1.5" style={{ color: '#B14919' }}>
              <input type="checkbox" name="confirm" value="yes" />
              Replace the current values
            </label>
          )}
        </div>
      </div>
    </form>
  )
}

function Field({ name, label, value, type = 'text', area = false }: {
  name: string; label: string; value: string; type?: string; area?: boolean
}) {
  return (
    <div>
      <label className="cd-label">{label}</label>
      {area
        ? <textarea name={name} defaultValue={value} rows={2} className="cd-input w-full text-sm" />
        : <input name={name} type={type} defaultValue={value} className="cd-input w-full text-sm" />}
    </div>
  )
}

function Select({ name, value, options }: { name: string; value: string; options: readonly string[] }) {
  return (
    <select name={name} defaultValue={value} className="cd-input text-sm">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="cd-thead">
          <tr>{head.map(h => <th key={h} className="px-2 py-1.5 text-left text-xs font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="cd-tbody">{children}</tbody>
      </table>
    </div>
  )
}

const Cell = ({ children }: { children: React.ReactNode }) => <td className="px-2 py-1.5">{children}</td>

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded" style={{ width: 28, height: 28, background: hex, border: '1px solid rgba(45,25,7,0.15)' }} />
      <span className="text-xs cd-muted">{label} {hex}</span>
    </div>
  )
}
