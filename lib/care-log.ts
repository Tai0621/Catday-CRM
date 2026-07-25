import { mealsPerDayFor } from './health'

// Daily care log analysis + SOP-driven task generation (boarding SOPs
// S002 feeding / S003 litter / S004 health). Pure functions shared by the run
// sheet, the log page, and the Action Inbox.

export type CareLogFields = {
  appetite: string | null
  stool: string | null
  urine: string | null
  energy: string | null
  behavior: string | null
  respiratory: string | null
  skin: string | null
  vomiting: boolean
}

// Values that mean "tell the manager / owner now" (SOP S004 immediate-action list).
export function logRedFlags(log: CareLogFields): string[] {
  const flags: string[] = []
  if (log.appetite === 'Refused') flags.push('Refused food')
  if (log.stool === 'Diarrhea') flags.push('Diarrhea')
  if (log.vomiting) flags.push('Vomiting')
  if (log.respiratory === 'Coughing' || log.respiratory === 'Labored') flags.push(`Breathing: ${log.respiratory.toLowerCase()}`)
  if (log.energy === 'Lethargic') flags.push('Lethargic')
  if (log.behavior && /Aggressive|Over-grooming/.test(log.behavior)) flags.push('Behaviour concern')
  if (log.skin === 'Parasites') flags.push('Parasites')
  return flags
}

// The care-task checklist for one stay on one day, derived from the SOPs and the
// cat's own feeding profile. Kittens (3+ meals) get a midday feed; medication
// only appears when the cat has one; the weekly/checkout full-litter change is
// flagged when due.
export function careTasksForStay(
  cat: { mealsPerDay: number | null; lifeStage: string | null; medication: string | null },
  opts: { fullLitterDue: boolean },
): string[] {
  const meals = mealsPerDayFor(cat)
  const tasks: string[] = ['Feed — morning']
  if (meals >= 3) tasks.push('Feed — midday')
  tasks.push('Feed — evening', 'Fresh water — morning', 'Fresh water — evening',
    'Litter clean — morning', 'Litter clean — evening')
  if (opts.fullLitterDue) tasks.push('Full litter change')
  if (cat.medication) tasks.push(`Medication: ${cat.medication}`)
  tasks.push('Play / enrichment')
  return tasks
}
