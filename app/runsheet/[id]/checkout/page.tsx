import { requireAuth, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { displayPhone } from '@/lib/phone'
import { ROOM_CONDITIONS, CAT_CONDITIONS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'
import { MediaSection } from '@/app/components/MediaSection'
import { SubmitButton } from '@/app/components/Pending'

// Guided boarding check-out (SOP mirror of check-in): record room + cat
// condition, tick off every belonging as returned, then send to POS for
// payment. Nothing gets left behind or unpaid.
export default async function CheckOutPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params
  const appt = await db.appointment.findUnique({
    where: { id },
    include: { cat: true, customer: true, room: true, boardingItems: { orderBy: { createdAt: 'asc' } } },
  })
  if (!appt || appt.type !== 'Boarding') notFound()

  const seg = SEGMENTS.boarding

  async function checkOut(data: FormData) {
    'use server'
    const s = await getSession()
    const roomCondition = (data.get('roomCondition') as string) || null
    const catCondition = data.getAll('catCondition').map(String).join(', ') || null
    const notes = ((data.get('notes') as string) || '').trim() || null
    const returnedIds = new Set(data.getAll('returned').map(String))
    const allCollected = data.get('allCollected') === 'on'

    const items = await db.boardingItem.findMany({ where: { appointmentId: id }, select: { id: true } })
    await Promise.all([
      db.boardingCheck.create({
        data: { appointmentId: id, phase: 'CheckOut', roomCondition, catCondition, allCollected, notes, staffId: s?.kind === 'staff' ? s.staffId : null },
      }),
      ...items.map(it => db.boardingItem.update({ where: { id: it.id }, data: { returned: returnedIds.has(it.id) } })),
      db.appointment.update({ where: { id }, data: { status: 'Completed' } }),
    ])
    // Physical exit recorded — settle the bill at POS.
    redirect(`/pos?customerId=${appt!.customerId}`)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/runsheet" className="text-xs cd-muted hover:underline">Run sheet</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Check-out</span>
        </div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Check out {appt.cat.name}
        </h1>
        <p className="text-sm cd-muted">
          {appt.room?.name ?? 'No room'} · {appt.customer.name ?? displayPhone(appt.customer.phone)}
        </p>
      </div>

      <form action={checkOut} className="space-y-5">
        {/* Items to return */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Return belongings <span className="cd-muted font-normal">· tick each item handed back</span></div>
          {appt.boardingItems.length === 0 ? (
            <p className="text-sm cd-muted">No belongings were logged at check-in.</p>
          ) : (
            <div className="space-y-1.5">
              {appt.boardingItems.map(it => (
                <label key={it.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" name="returned" value={it.id} defaultChecked={it.returned}
                    className="w-5 h-5" style={{ accentColor: '#729094' }} />
                  <span className="text-sm" style={{ color: '#2D1907' }}>{it.label}</span>
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input type="checkbox" name="allCollected" className="w-5 h-5" style={{ accentColor: '#729094' }} />
            <span className="text-sm font-medium" style={{ color: '#2D1907' }}>Owner confirmed all belongings collected</span>
          </label>
        </div>

        {/* Room condition */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Room condition on exit</div>
          <div className="flex flex-wrap gap-2">
            {ROOM_CONDITIONS.map((c, idx) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="roomCondition" value={c} defaultChecked={idx === 0} className="peer sr-only" />
                <span className="inline-block px-3 py-2 rounded-lg border text-sm peer-checked:bg-[#729094] peer-checked:text-[#F2EDE0] peer-checked:border-[#729094]"
                  style={{ borderColor: 'rgba(45,25,7,0.2)', color: '#2D1907' }}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Cat condition */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Cat condition at check-out <span className="cd-muted font-normal">· tap all that apply</span></div>
          <div className="flex flex-wrap gap-2">
            {CAT_CONDITIONS.map(c => (
              <label key={c} className="cursor-pointer">
                <input type="checkbox" name="catCondition" value={c} className="peer sr-only" />
                <span className="inline-block px-3 py-2 rounded-lg border text-sm peer-checked:bg-[#B14919] peer-checked:text-[#F2EDE0] peer-checked:border-[#B14919]"
                  style={{ borderColor: 'rgba(45,25,7,0.2)', color: '#2D1907' }}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Exit photo */}
        <div className="cd-card p-4 space-y-2">
          <div className="cd-label">Check-out condition photo/video <span className="cd-muted font-normal">· optional</span></div>
          <MediaSection ownerType="condition" ownerId={id} tag="checkout" accept="both" label="photo" />
        </div>

        <div className="cd-card p-4">
          <label className="cd-label">Notes</label>
          <input name="notes" className="cd-input" placeholder="anything to tell the owner" />
        </div>

        <div className="flex items-center gap-3">
          <SubmitButton className="cd-btn" busyLabel="Working…">Complete check-out → payment</SubmitButton>
          <Link href="/runsheet" className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
