import { db } from './db'
import { getConfig } from './config'

// Grooming-side capacity: open hours × groomers on duty × service duration.
// A slot is open if at least one groomer is free for the whole duration.

const GROOM_TYPES = ['Grooming', 'Bath', 'Diagnosis']
const DAY = 24 * 60 * 60 * 1000

export interface OpenSlot {
  time: string // "HH:MM"
  free: number // how many groomers still free at this start time
}

export async function groomerCapacity(): Promise<number> {
  const groomers = await db.staff.count({ where: { role: 'Groomer', active: true } })
  return Math.max(1, groomers)
}

export async function openSlots(dateStr: string, durationMin: number): Promise<{ slots: OpenSlot[]; capacity: number }> {
  const dayStart = new Date(`${dateStr}T00:00:00`)
  if (isNaN(dayStart.getTime())) return { slots: [], capacity: 1 }
  const dayEnd = new Date(dayStart.getTime() + DAY)

  const [capacity, appts, config] = await Promise.all([
    groomerCapacity(),
    db.appointment.findMany({
      where: {
        type: { in: GROOM_TYPES },
        status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { lt: dayEnd },
        OR: [{ endsAt: { gt: dayStart } }, { endsAt: null, scheduledAt: { gte: dayStart } }],
      },
      select: { scheduledAt: true, endsAt: true },
    }),
    getConfig(),
  ])
  const { openHour, closeHour, slotStepMin } = config.ops

  const busy = appts.map(a => ({
    start: a.scheduledAt.getTime(),
    end: (a.endsAt ?? new Date(a.scheduledAt.getTime() + 60 * 60 * 1000)).getTime(),
  }))

  const slots: OpenSlot[] = []
  const duration = Math.max(15, durationMin) * 60 * 1000
  for (let h = openHour * 60; h + Math.max(15, durationMin) <= closeHour * 60; h += slotStepMin) {
    const start = dayStart.getTime() + h * 60 * 1000
    const end = start + duration
    const overlapping = busy.filter(b => b.start < end && b.end > start).length
    const free = capacity - overlapping
    if (free > 0) {
      const hh = String(Math.floor(h / 60)).padStart(2, '0')
      const mm = String(h % 60).padStart(2, '0')
      slots.push({ time: `${hh}:${mm}`, free })
    }
  }
  return { slots, capacity }
}
