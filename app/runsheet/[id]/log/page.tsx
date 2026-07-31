import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  LOG_APPETITE, LOG_STOOL, LOG_URINE, LOG_ENERGY, LOG_BEHAVIOR, LOG_RESPIRATORY, LOG_SKIN, LOG_PERIODS,
} from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { MediaSection } from '@/app/components/MediaSection'

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const seg = SEGMENTS.boarding

// Structured daily health & behaviour log (SOP S004) — tap-to-select, one entry
// per AM/PM. Re-opening the same period pre-fills the saved answers.
export default async function DailyLogPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string }>
}) {
  await requireAuth()
  const { id } = await params
  const { period: periodRaw } = await searchParams
  const period = (LOG_PERIODS as readonly string[]).includes(periodRaw ?? '') ? periodRaw! : 'AM'
  const today = dateKey(new Date())

  const appt = await db.appointment.findUnique({ where: { id }, include: { cat: true } })
  if (!appt || appt.type !== 'Boarding') notFound()
  const existing = await db.dailyCareLog.findUnique({
    where: { appointmentId_date_period: { appointmentId: id, date: today, period } },
  })

  async function save(data: FormData) {
    'use server'
    const s = await getSession()
    const v = (k: string) => ((data.get(k) as string) || null)
    const payload = {
      appetite: v('appetite'), stool: v('stool'), urine: v('urine'), energy: v('energy'),
      behavior: data.getAll('behavior').map(String).join(', ') || null,
      respiratory: v('respiratory'), skin: v('skin'),
      vomiting: data.get('vomiting') === 'on',
      notes: ((data.get('notes') as string) || '').trim() || null,
      staffId: s?.kind === 'staff' ? s.staffId : null,
    }
    await db.dailyCareLog.upsert({
      where: { appointmentId_date_period: { appointmentId: id, date: today, period } },
      create: { appointmentId: id, catId: appt!.catId, date: today, period, ...payload },
      update: payload,
    })
    redirect('/runsheet')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/runsheet" className="text-xs cd-muted hover:underline">Run sheet</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Daily log</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          {appt.cat.name} · {period === 'AM' ? '☀️' : '🌙'} {period} check
        </h1>
        <div className="flex gap-2 mt-2">
          {LOG_PERIODS.map(p => (
            <Link key={p} href={`/runsheet/${id}/log?period=${p}`}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={p === period ? { background: seg.color, color: '#F2EDE0', fontWeight: 600 } : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)' }}>
              {p === 'AM' ? '☀️' : '🌙'} {p}
            </Link>
          ))}
        </div>
      </div>

      <form action={save} className="space-y-4">
        <ChipGroup label="🍽️ Appetite" name="appetite" options={LOG_APPETITE} selected={existing?.appetite} />
        <ChipGroup label="💩 Stool" name="stool" options={LOG_STOOL} selected={existing?.stool} />
        <ChipGroup label="💧 Urine" name="urine" options={LOG_URINE} selected={existing?.urine} />
        <ChipGroup label="⚡ Energy" name="energy" options={LOG_ENERGY} selected={existing?.energy} />
        <ChipGroup label="😺 Behaviour" name="behavior" options={LOG_BEHAVIOR} multi selected={existing?.behavior} />
        <ChipGroup label="🫁 Breathing" name="respiratory" options={LOG_RESPIRATORY} selected={existing?.respiratory} />
        <ChipGroup label="✨ Skin & coat" name="skin" options={LOG_SKIN} selected={existing?.skin} />

        <div className="cd-card p-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="vomiting" defaultChecked={existing?.vomiting ?? false} className="w-5 h-5" style={{ accentColor: '#B14919' }} />
            <span className="text-sm font-medium" style={{ color: '#2D1907' }}>🤢 Vomiting seen</span>
          </label>
        </div>

        <div className="cd-card p-4 space-y-2">
          <label className="cd-label">📝 Notes <span className="cd-muted font-normal">· optional</span></label>
          <input name="notes" defaultValue={existing?.notes ?? ''} className="cd-input" placeholder="anything else" />
          <MediaSection ownerType="condition" ownerId={id} tag={`log-${period}`} accept="both" label="photo" title="Photo / video" />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="cd-btn">Save {period} log</button>
          <Link href="/runsheet" className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}

function ChipGroup({ label, name, options, selected, multi }: {
  label: string; name: string; options: readonly string[]; selected?: string | null; multi?: boolean
}) {
  const chosen = new Set((selected ?? '').split(',').map(s => s.trim()).filter(Boolean))
  return (
    <div className="cd-card p-4 space-y-2">
      <div className="cd-label">{label}{multi && <span className="cd-muted font-normal"> · tap all that apply</span>}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <label key={o} className="cursor-pointer">
            <input type={multi ? 'checkbox' : 'radio'} name={name} value={o} defaultChecked={chosen.has(o)} className="peer sr-only" />
            <span className="inline-block px-3 py-2 rounded-lg border text-sm peer-checked:bg-[#729094] peer-checked:text-[#F2EDE0] peer-checked:border-[#729094]"
              style={{ borderColor: 'rgba(45,25,7,0.2)', color: '#2D1907' }}>{o}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
