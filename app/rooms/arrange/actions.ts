'use server'

import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { UNIT_KINDS, ZONE_KINDS } from '@/lib/constants'

// Arranging the wall. Manager-only: where a room sits decides what a carer
// reads at a glance, and a wrong placement means feeding the wrong cat.

const str = (d: FormData, k: string) => ((d.get(k) as string) ?? '').trim()
const int = (d: FormData, k: string, fallback: number | null = null) => {
  const n = parseInt(str(d, k), 10)
  return Number.isFinite(n) ? n : fallback
}
const oneOf = <T extends readonly string[]>(v: string, allowed: T, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback

function touch() {
  revalidatePath('/rooms')
  revalidatePath('/rooms/arrange')
  revalidatePath('/rooms/calendar')
}

function fail(message: string): never {
  redirect(`/rooms/arrange?error=${encodeURIComponent(message)}`)
}

export async function saveZone(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const code = str(data, 'code').toUpperCase()
  const name = str(data, 'name')
  if (!code) fail('A zone needs a code.')
  if (!name) fail('A zone needs a name.')

  const cols = Math.max(1, Math.min(12, int(data, 'cols', 1) ?? 1))
  const rows = Math.max(1, Math.min(12, int(data, 'rows', 1) ?? 1))
  const kind = oneOf(str(data, 'kind'), ZONE_KINDS, 'Boarding')
  const sortOrder = int(data, 'sortOrder', 0) ?? 0

  const clash = await db.roomZone.findUnique({ where: { code }, select: { id: true } })
  if (clash && clash.id !== id) fail(`Zone ${code} already exists.`)

  if (id) {
    await db.roomZone.update({ where: { id }, data: { code, name, cols, rows, kind, sortOrder } })
  } else {
    await db.roomZone.create({ data: { code, name, cols, rows, kind, sortOrder } })
  }
  touch()
  redirect('/rooms/arrange')
}

export async function deleteZone(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const zone = await db.roomZone.findUnique({ where: { id }, select: { code: true, _count: { select: { rooms: true } } } })
  if (!zone) fail('Not found.')
  if (zone._count.rooms > 0) fail(`${zone.code} still holds ${zone._count.rooms} room(s). Unplace them first.`)
  await db.roomZone.delete({ where: { id } })
  touch()
  redirect('/rooms/arrange')
}

/**
 * Give one room its place.
 *
 * Clearing the zone unplaces it — which is a legitimate move, and the room then
 * appears in the wall's Unplaced strip rather than vanishing.
 */
export async function placeRoom(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const room = await db.room.findUnique({ where: { id }, select: { name: true } })
  if (!room) fail('Not found.')

  const zoneId = str(data, 'zoneId') || null
  const gridCol = zoneId ? int(data, 'gridCol') : null
  const gridRow = zoneId ? int(data, 'gridRow') : null
  const colSpan = Math.max(1, int(data, 'colSpan', 1) ?? 1)
  const rowSpan = Math.max(1, int(data, 'rowSpan', 1) ?? 1)
  const unitKind = oneOf(str(data, 'unitKind'), UNIT_KINDS, 'arch')

  if (zoneId) {
    const zone = await db.roomZone.findUnique({ where: { id: zoneId }, select: { cols: true, rows: true, code: true } })
    if (!zone) fail('That bank no longer exists.')
    if (gridCol == null || gridRow == null) fail('A placed room needs both a column and a row.')
    if (gridCol < 1 || gridCol + colSpan - 1 > zone.cols) fail(`${room.name} does not fit across ${zone.code} — it has ${zone.cols} columns.`)
    if (gridRow < 1 || gridRow + rowSpan - 1 > zone.rows) fail(`${room.name} does not fit down ${zone.code} — it has ${zone.rows} rows.`)

    // Two rooms drawn in one cell means one of them is invisible, and an
    // invisible room is exactly how a cat gets missed on a round.
    const siblings = await db.room.findMany({
      where: { zoneId, isActive: true, NOT: { id } },
      select: { id: true, name: true, gridCol: true, gridRow: true, colSpan: true, rowSpan: true },
    })
    const overlaps = siblings.find(s => {
      if (s.gridCol == null || s.gridRow == null) return false
      const colHit = gridCol < s.gridCol + s.colSpan && s.gridCol < gridCol + colSpan
      const rowHit = gridRow < s.gridRow + s.rowSpan && s.gridRow < gridRow + rowSpan
      return colHit && rowHit
    })
    if (overlaps) fail(`That cell is already taken by ${overlaps.name}.`)
  }

  await db.room.update({
    where: { id },
    data: { zoneId, gridCol, gridRow, colSpan, rowSpan, unitKind },
  })
  await recordAudit({
    action: 'room.place', entityType: 'Room', entityId: id,
    summary: zoneId ? `${room.name} placed at ${gridCol},${gridRow}` : `${room.name} unplaced`,
  })
  touch()
  redirect('/rooms/arrange')
}
