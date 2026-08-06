'use server'

import { db } from '@/lib/db'
import { getSession, requireAuth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
  LOG_APPETITE, LOG_STOOL, LOG_URINE, LOG_ENERGY,
  LOG_BEHAVIOR, LOG_RESPIRATORY, LOG_SKIN, LOG_PERIODS,
} from '@/lib/constants'

// The daily-care-log write, extracted so the copilot's confirm gate (C2)
// executes the same function the run sheet's form does.
//
// The manual UI is a set of chips, so it can only ever submit a value from the
// list. Nothing else could — until a model started filling this in, at which
// point "Ate most of it" would sail into a column the red-flag alerting reads
// by exact match. Hence the allow-lists live HERE rather than in the page: the
// field vocabulary is the contract, and both callers are now held to it.

export type CareLogFields = {
  appetite?: string | null
  stool?: string | null
  urine?: string | null
  energy?: string | null
  behavior?: string[] | null
  respiratory?: string | null
  skin?: string | null
  vomiting?: boolean
  notes?: string | null
}
export type CareLogResult = { ok: true; id: string } | { ok: false; error: string }

const pick = (value: string | null | undefined, allowed: readonly string[], field: string) => {
  if (!value) return { value: null }
  if (!allowed.includes(value)) return { error: `"${value}" is not a valid ${field} — expected one of: ${allowed.join(', ')}.` }
  return { value }
}

export async function saveCareLog(
  appointmentId: string,
  date: string, // YYYY-MM-DD
  period: string,
  fields: CareLogFields,
): Promise<CareLogResult> {
  await requireAuth()

  if (!(LOG_PERIODS as readonly string[]).includes(period)) return { ok: false, error: `"${period}" is not a log period.` }

  const appt = await db.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, catId: true, type: true } })
  if (!appt) return { ok: false, error: 'That stay no longer exists.' }
  if (appt.type !== 'Boarding') return { ok: false, error: 'Daily care logs belong to boarding stays.' }

  const checks = [
    { key: 'appetite', ...pick(fields.appetite, LOG_APPETITE, 'appetite') },
    { key: 'stool', ...pick(fields.stool, LOG_STOOL, 'stool') },
    { key: 'urine', ...pick(fields.urine, LOG_URINE, 'urine') },
    { key: 'energy', ...pick(fields.energy, LOG_ENERGY, 'energy') },
    { key: 'respiratory', ...pick(fields.respiratory, LOG_RESPIRATORY, 'respiratory') },
    { key: 'skin', ...pick(fields.skin, LOG_SKIN, 'skin') },
  ]
  const bad = checks.find(c => c.error)
  if (bad) return { ok: false, error: bad.error! }

  const behaviors = fields.behavior ?? []
  const badBehavior = behaviors.find(b => !(LOG_BEHAVIOR as readonly string[]).includes(b))
  if (badBehavior) return { ok: false, error: `"${badBehavior}" is not a valid behaviour.` }

  const session = await getSession()
  const payload = {
    appetite: checks[0].value ?? null,
    stool: checks[1].value ?? null,
    urine: checks[2].value ?? null,
    energy: checks[3].value ?? null,
    respiratory: checks[4].value ?? null,
    skin: checks[5].value ?? null,
    behavior: behaviors.join(', ') || null,
    vomiting: fields.vomiting === true,
    notes: fields.notes?.trim() || null,
    staffId: session?.kind === 'staff' ? session.staffId : null,
  }

  const log = await db.dailyCareLog.upsert({
    where: { appointmentId_date_period: { appointmentId, date, period } },
    create: { appointmentId, catId: appt.catId, date, period, ...payload },
    update: payload,
  })

  revalidatePath('/runsheet')
  return { ok: true, id: log.id }
}
