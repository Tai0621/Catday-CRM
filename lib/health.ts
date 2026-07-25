import {
  DEWORM_INTERVAL_DAYS, DEFLEA_INTERVAL_DAYS, MEALS_BY_LIFE_STAGE, DEFAULT_MEALS_PER_DAY,
  BOARDING_TREATMENT_CHARGE,
} from './constants'

// Health & feeding logic derived from the boarding SOPs (S002/S004). Pure —
// callers pass the cat fields, so it's shared by the cat page, the Action Inbox,
// and (next round) the boarding check-in gate.

const DAY = 24 * 60 * 60 * 1000

export type HealthState = 'ok' | 'due' | 'overdue' | 'missing'
export interface HealthStatus {
  state: HealthState
  lastAt: Date | null
  dueAt: Date | null
  days: number | null // days until due (negative = overdue)
}

function intervalStatus(lastAt: Date | null, intervalDays: number, now: Date, alertDays: number): HealthStatus {
  if (!lastAt) return { state: 'missing', lastAt: null, dueAt: null, days: null }
  const dueAt = new Date(lastAt.getTime() + intervalDays * DAY)
  const days = Math.floor((dueAt.getTime() - now.getTime()) / DAY)
  const state: HealthState = days < 0 ? 'overdue' : days <= alertDays ? 'due' : 'ok'
  return { state, lastAt, dueAt, days }
}

// vaccinationExpiry is an explicit expiry date (not "last done + interval").
export function vaccinationStatus(expiry: Date | null, now: Date, alertDays = 30): HealthStatus {
  if (!expiry) return { state: 'missing', lastAt: null, dueAt: null, days: null }
  const days = Math.floor((expiry.getTime() - now.getTime()) / DAY)
  const state: HealthState = days < 0 ? 'overdue' : days <= alertDays ? 'due' : 'ok'
  return { state, lastAt: null, dueAt: expiry, days }
}

export function dewormStatus(lastAt: Date | null, now: Date, alertDays = 7): HealthStatus {
  return intervalStatus(lastAt, DEWORM_INTERVAL_DAYS, now, alertDays)
}
export function defleaStatus(lastAt: Date | null, now: Date, alertDays = 7): HealthStatus {
  return intervalStatus(lastAt, DEFLEA_INTERVAL_DAYS, now, alertDays)
}

// Meals/day for a cat: explicit override, else derived from life stage (S002).
export function mealsPerDayFor(cat: { mealsPerDay: number | null; lifeStage: string | null }): number {
  if (cat.mealsPerDay && cat.mealsPerDay > 0) return cat.mealsPerDay
  return (cat.lifeStage && MEALS_BY_LIFE_STAGE[cat.lifeStage]) || DEFAULT_MEALS_PER_DAY
}

export type CatHealthFields = {
  vaccinationExpiry: Date | null
  lastDewormAt: Date | null
  lastDefleaAt: Date | null
}

// The boarding admission gate (SOPs): vaccination is a hard requirement;
// deworm/deflea not current → an on-site treatment is auto-charged, not blocked.
export interface BoardingHealthGate {
  ready: boolean            // no hard blockers
  vaccination: HealthStatus
  deworm: HealthStatus
  deflea: HealthStatus
  blockers: string[]        // hard requirements unmet (vaccination)
  treatmentsNeeded: string[]// deworm/deflea not current → will be charged
  autoChargeRM: number
}

export function boardingHealthGate(cat: CatHealthFields, now: Date = new Date()): BoardingHealthGate {
  const vaccination = vaccinationStatus(cat.vaccinationExpiry, now)
  const deworm = dewormStatus(cat.lastDewormAt, now)
  const deflea = defleaStatus(cat.lastDefleaAt, now)

  const blockers: string[] = []
  if (vaccination.state === 'overdue' || vaccination.state === 'missing') blockers.push('Vaccination')

  const treatmentsNeeded: string[] = []
  if (deworm.state === 'overdue' || deworm.state === 'missing') treatmentsNeeded.push('Deworm')
  if (deflea.state === 'overdue' || deflea.state === 'missing') treatmentsNeeded.push('Deflea')

  return {
    ready: blockers.length === 0,
    vaccination, deworm, deflea,
    blockers, treatmentsNeeded,
    autoChargeRM: treatmentsNeeded.length * BOARDING_TREATMENT_CHARGE,
  }
}
