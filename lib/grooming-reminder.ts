import { GROOMING_INTERVALS, GROOMING_REMINDER_WINDOW_DAYS } from './constants'

export interface GroomingPrediction {
  catId: string
  catName: string
  customerId: string
  customerName: string | null
  customerPhone: string
  lastGroomedAt: Date | null
  nextDueAt: Date
  daysUntilDue: number
  isOverdue: boolean
}

function intervalForBreed(breed: string | null | undefined, customInterval?: number | null): number {
  if (customInterval) return customInterval
  if (!breed) return GROOMING_INTERVALS['default']
  return GROOMING_INTERVALS[breed] ?? GROOMING_INTERVALS['default']
}

export function predictNextGrooming(
  lastDate: Date | null,
  breed: string | null | undefined,
  customInterval?: number | null,
): Date {
  const interval = intervalForBreed(breed, customInterval)
  const base = lastDate ?? new Date()
  return new Date(base.getTime() + interval * 24 * 60 * 60 * 1000)
}

type CatWithAppointments = {
  id: string
  name: string
  breed: string | null
  groomingInterval: number | null
  customerId: string
  customer: {
    name: string | null
    phone: string
  }
  appointments: {
    scheduledAt: Date
    status: string
    type: string
  }[]
}

export function buildGroomingPredictions(cats: CatWithAppointments[]): GroomingPrediction[] {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + GROOMING_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const predictions: GroomingPrediction[] = []

  for (const cat of cats) {
    const completedGroomings = cat.appointments
      .filter(a => a.type === 'Grooming' && a.status === 'Completed')
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())

    const lastGroomedAt = completedGroomings[0]?.scheduledAt ?? null
    const nextDueAt = predictNextGrooming(lastGroomedAt, cat.breed, cat.groomingInterval)
    const daysUntilDue = Math.ceil((nextDueAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))

    if (nextDueAt <= windowEnd) {
      predictions.push({
        catId: cat.id,
        catName: cat.name,
        customerId: cat.customerId,
        customerName: cat.customer.name,
        customerPhone: cat.customer.phone,
        lastGroomedAt,
        nextDueAt,
        daysUntilDue,
        isOverdue: nextDueAt < now,
      })
    }
  }

  return predictions.sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime())
}
