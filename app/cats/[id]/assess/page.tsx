import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ASSESSMENT_OPTIONS, COAT_TYPES, COAT_CYCLE_DAYS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'

// Groomer diagnosis & profiling (建档) — fill after the hands-on check, per SOP:
// record everything, explain objectively, no upselling.
export default async function AssessCatPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const cat = await db.cat.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, phone: true } },
      assessments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!cat) notFound()
  const prev = cat.assessments[0]

  async function saveAssessment(data: FormData) {
    'use server'
    const str = (k: string) => ((data.get(k) as string) || '').trim() || null
    const num = (k: string) => {
      const v = parseFloat((data.get(k) as string) || '')
      return Number.isFinite(v) && v > 0 ? v : null
    }
    const rebookDays = num('rebookDays')
    const coatType = str('coatType')

    await db.catAssessment.create({
      data: {
        catId: id,
        skinCondition: str('skinCondition'),
        coatCondition: str('coatCondition'),
        earCondition: str('earCondition'),
        nailCondition: str('nailCondition'),
        stressLevel: str('stressLevel'),
        weightKg: num('weightKg'),
        findings: str('findings'),
        carePlan: str('carePlan'),
        rebookDays: rebookDays ? Math.round(rebookDays) : null,
      },
    })
    // The recommended cycle becomes the cat's live rebooking interval —
    // this is what drives the "grooming due" action cards.
    await db.cat.update({
      where: { id },
      data: {
        coatType,
        ...(rebookDays ? { groomingInterval: Math.round(rebookDays) } : {}),
      },
    })
    redirect(`/cats/${id}`)
  }

  const seg = SEGMENTS.grooming
  const defaultCycle = cat.groomingInterval
    ?? (cat.coatType ? COAT_CYCLE_DAYS[cat.coatType] : null)
    ?? 30

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Link href="/cats" className="text-xs cd-muted hover:underline">Cats</Link>
          <span className="text-xs cd-muted">›</span>
          <Link href={`/cats/${id}`} className="text-xs cd-link">{cat.name}</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Assessment</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Groomer Assessment — {cat.name}
        </h1>
        <p className="text-sm cd-muted">
          Owner: {cat.customer.name ?? cat.customer.phone} · Record what you found, hand the care plan to the owner, set the rebooking cycle. No upselling — the profile does the selling.
        </p>
      </div>

      <form action={saveAssessment} className="cd-card p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SelectField name="skinCondition" label="Skin" options={ASSESSMENT_OPTIONS.skinCondition} defaultValue={prev?.skinCondition} />
          <SelectField name="coatCondition" label="Coat / fur" options={ASSESSMENT_OPTIONS.coatCondition} defaultValue={prev?.coatCondition} />
          <SelectField name="earCondition" label="Ears" options={ASSESSMENT_OPTIONS.earCondition} defaultValue={prev?.earCondition} />
          <SelectField name="nailCondition" label="Nails" options={ASSESSMENT_OPTIONS.nailCondition} defaultValue={prev?.nailCondition} />
          <SelectField name="stressLevel" label="Stress level" options={ASSESSMENT_OPTIONS.stressLevel} defaultValue={prev?.stressLevel} />
          <div>
            <label className="cd-label">Weight (kg)</label>
            <input name="weightKg" type="number" step="0.1" min="0" className="cd-input"
              defaultValue={prev?.weightKg ?? ''} placeholder="e.g. 4.2" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="cd-label">Coat type</label>
            <select name="coatType" className="cd-input" defaultValue={cat.coatType ?? ''}>
              <option value="">— not set —</option>
              {COAT_TYPES.map(t => (
                <option key={t} value={t}>{t} hair (default cycle {COAT_CYCLE_DAYS[t]}d)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="cd-label">Rebook cycle (days)</label>
            <input name="rebookDays" type="number" min="7" max="120" className="cd-input"
              defaultValue={defaultCycle} />
            <p className="text-xs cd-muted mt-1">Drives the automatic “grooming due” reminder for this cat.</p>
          </div>
        </div>

        <div>
          <label className="cd-label">Findings (objective — what you observed)</label>
          <textarea name="findings" rows={3} className="cd-input"
            defaultValue={''} placeholder="e.g. Mild matting behind ears, slightly oily base coat, small dry patch on lower back…" />
        </div>

        <div>
          <label className="cd-label">Quarterly care plan (handed to the owner)</label>
          <textarea name="carePlan" rows={3} className="cd-input"
            defaultValue={prev?.carePlan ?? ''} placeholder="e.g. Weekly brushing behind ears, de-mat session every 3 weeks, oatmeal shampoo at home once a month…" />
        </div>

        <div className="flex items-center justify-between pt-1">
          <Link href={`/cats/${id}`} className="cd-btn-sec text-sm">Cancel</Link>
          <button type="submit" className="cd-btn">Save assessment</button>
        </div>
      </form>
    </div>
  )
}

function SelectField({ name, label, options, defaultValue }: {
  name: string; label: string; options: readonly string[]; defaultValue?: string | null
}) {
  return (
    <div>
      <label className="cd-label">{label}</label>
      <select name={name} className="cd-input" defaultValue={defaultValue ?? ''}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
