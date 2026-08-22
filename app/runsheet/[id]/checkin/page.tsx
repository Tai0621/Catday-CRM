import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { displayPhone } from '@/lib/phone'
import { ROOM_CONDITIONS, CAT_CONDITIONS, BOARDING_TREATMENT_CHARGE } from '@/lib/constants'
import { boardingHealthGate } from '@/lib/health'
import { SEGMENTS } from '@/lib/segments'
import { MediaSection } from '@/app/components/MediaSection'
import { SubmitButton } from '@/app/components/Pending'

// Guided boarding check-in (SOP): confirm health, record room + cat condition,
// log the belongings the owner brought (photographed), and admit the cat. If
// deworm/deflea isn't current, the on-site treatment is administered here and
// added to the bill (owner's rule); vaccination is a hard requirement that
// needs a manager override to bypass.
export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params
  const appt = await db.appointment.findUnique({
    where: { id },
    include: { cat: true, customer: true, room: true },
  })
  if (!appt || appt.type !== 'Boarding') notFound()
  if (appt.status === 'CheckedIn') redirect('/runsheet')

  const gate = boardingHealthGate(appt.cat)
  const seg = SEGMENTS.boarding

  async function checkIn(data: FormData) {
    'use server'
    const s = await getSession()
    const roomCondition = (data.get('roomCondition') as string) || null
    const catCondition = data.getAll('catCondition').map(String).join(', ') || null
    const notes = ((data.get('notes') as string) || '').trim() || null
    const items = ((data.get('belongings') as string) || '').split('\n').map(x => x.trim()).filter(Boolean)
    const administer = data.get('administerTreatment') === 'on'

    const cur = await db.appointment.findUnique({ where: { id }, select: { price: true, notes: true, catId: true } })
    if (!cur) redirect('/runsheet')

    const ops: Promise<unknown>[] = []
    ops.push(db.boardingCheck.create({
      data: { appointmentId: id, phase: 'CheckIn', roomCondition, catCondition, notes, staffId: s?.kind === 'staff' ? s.staffId : null },
    }))
    for (const label of items) ops.push(db.boardingItem.create({ data: { appointmentId: id, label } }))

    // On-site parasite treatment: mark the cat current + add the fee to the bill.
    const g = boardingHealthGate(appt!.cat)
    if (administer && g.treatmentsNeeded.length > 0) {
      const catData: { lastDewormAt?: Date; lastDefleaAt?: Date } = {}
      if (g.treatmentsNeeded.includes('Deworm')) catData.lastDewormAt = new Date()
      if (g.treatmentsNeeded.includes('Deflea')) catData.lastDefleaAt = new Date()
      ops.push(db.cat.update({ where: { id: cur.catId }, data: catData }))
      const charge = g.treatmentsNeeded.length * BOARDING_TREATMENT_CHARGE
      ops.push(db.appointment.update({
        where: { id },
        data: {
          price: Math.round(((cur.price ?? 0) + charge) * 100) / 100,
          notes: [cur.notes, `+RM${charge} ${g.treatmentsNeeded.join('/')} on check-in`].filter(Boolean).join(' · '),
        },
      }))
    }
    await Promise.all(ops)
    await db.appointment.update({ where: { id }, data: { status: 'CheckedIn' } })
    redirect('/runsheet')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/runsheet" className="text-xs cd-muted hover:underline">Run sheet</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Check-in</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Check in {appt.cat.name}
        </h1>
        <p className="text-sm cd-muted">
          {appt.room?.name ?? 'No room assigned'} · {appt.customer.name ?? displayPhone(appt.customer.phone)} ·
          {' '}until {appt.endsAt?.toLocaleDateString('en-MY') ?? '—'}
        </p>
      </div>

      {/* Health gate */}
      <div className="cd-card p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: seg.text }}>Health check</div>
        {gate.blockers.length > 0 && (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
            ⚠ <strong>{gate.blockers.join(', ')}</strong> not valid — mandatory for boarding. Confirm with the manager before admitting.
          </div>
        )}
        {gate.treatmentsNeeded.length === 0 && gate.blockers.length === 0 && (
          <div className="text-sm" style={{ color: '#4d6330' }}>✓ Vaccination valid · deworm &amp; flea current — all clear.</div>
        )}
        {gate.blockers.length === 0 && gate.treatmentsNeeded.length === 0 ? null : (
          <div className="text-xs cd-muted">
            Vaccination {gate.vaccination.state} · Deworm {gate.deworm.state} · Flea {gate.deflea.state}
          </div>
        )}
      </div>

      <form action={checkIn} className="space-y-5">
        {/* Treatment (only if needed) */}
        {gate.treatmentsNeeded.length > 0 && (
          <div className="cd-card p-4" style={{ background: 'rgba(184,144,43,0.1)', border: '1px solid rgba(184,144,43,0.35)' }}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" name="administerTreatment" defaultChecked className="mt-1" />
              <span className="text-sm" style={{ color: '#2D1907' }}>
                Administer <strong>{gate.treatmentsNeeded.join(' + ')}</strong> treatment now
                (+RM {gate.autoChargeRM}, added to the bill) — {appt.cat.name} isn&apos;t current.
              </span>
            </label>
          </div>
        )}

        {/* Room condition (single) */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Room condition</div>
          <div className="flex flex-wrap gap-2">
            {ROOM_CONDITIONS.map((c, idx) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="roomCondition" value={c} defaultChecked={idx === 0} className="peer sr-only" />
                <span className="cd-chip peer-checked:bg-[#729094] peer-checked:text-[#F2EDE0] peer-checked:border-[#729094]"
                  style={{ borderColor: 'rgba(45,25,7,0.2)', color: '#2D1907' }}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Cat condition (multi) */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Cat condition on arrival <span className="cd-muted font-normal">· tap all that apply</span></div>
          <div className="flex flex-wrap gap-2">
            {CAT_CONDITIONS.map(c => (
              <label key={c} className="cursor-pointer">
                <input type="checkbox" name="catCondition" value={c} className="peer sr-only" />
                <span className="cd-chip peer-checked:bg-[#B14919] peer-checked:text-[#F2EDE0] peer-checked:border-[#B14919]"
                  style={{ borderColor: 'rgba(45,25,7,0.2)', color: '#2D1907' }}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Belongings */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Belongings brought in <span className="cd-muted font-normal">· one per line, ticked off at check-out</span></div>
          <textarea name="belongings" rows={3} placeholder={'e.g.\nBlue carrier\nFood container\nFavourite toy'} className="cd-input" />
          <MediaSection ownerType="belongings" ownerId={id} accept="image" label="belongings photo" title="Photos of belongings" />
        </div>

        {/* Arrival photo */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Arrival condition photo/video <span className="cd-muted font-normal">· optional</span></div>
          <MediaSection ownerType="condition" ownerId={id} tag="checkin" accept="both" label="photo" />
        </div>

        <div className="cd-card p-4">
          <label className="cd-label">Notes</label>
          <input name="notes" className="cd-input" placeholder="anything the carer should know" />
        </div>

        <div className="flex items-center gap-3">
          <SubmitButton className="cd-btn" busyLabel="Working…">Complete check-in</SubmitButton>
          <Link href="/runsheet" className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
