import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROOM_TYPES } from '@/lib/constants'
import { SubmitButton } from '@/app/components/Pending'

export default async function NewRoomPage() {
  await requireAuth()

  async function create(data: FormData) {
    'use server'
    const count = await db.room.count()
    const type = (data.get('type') as string) || 'Standard'
    const capRaw = parseInt((data.get('capacity') as string) || '', 10)
    const capacity = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : type === 'Suite' ? 6 : type === 'DayStay' ? 1 : 2
    await db.room.create({
      data: {
        name: data.get('name') as string,
        type,
        capacity,
        description: (data.get('description') as string) || null,
        sortOrder: count,
      },
    })
    redirect('/rooms')
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div>
        <Link href="/rooms" className="text-xs cd-muted hover:underline">← Boarding Wall</Link>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Add Room</h1>
        {/* A new room has no cell on the wall yet, so it lands in Unplaced
            rather than nowhere. Saying so here stops it reading as a bug. */}
        <p className="text-sm cd-muted">
          It appears under Unplaced until you give it a spot in <Link href="/rooms/arrange" className="cd-link">Arrange</Link>.
        </p>
      </div>

      <form action={create} className="cd-card p-5 space-y-4">
        <div>
          <label className="cd-label">Room name *</label>
          <input name="name" required placeholder="e.g. Suite A, Room 1, Day Stay 3" className="cd-input" />
        </div>
        <div>
          <label className="cd-label">Type</label>
          <select name="type" className="cd-input">
            {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Capacity (cats)</label>
          <input name="capacity" type="number" min="1" max="10" className="cd-input"
            placeholder="blank = by type (Standard 2, Suite 6, Day Stay 1)" />
        </div>
        <div>
          <label className="cd-label">Description</label>
          <input name="description" placeholder="Optional notes about this room" className="cd-input" />
        </div>
        <div className="flex gap-3 pt-1 items-center">
          <SubmitButton className="cd-btn" busyLabel="Working…">Add Room</SubmitButton>
          <Link href="/rooms" className="cd-link text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
