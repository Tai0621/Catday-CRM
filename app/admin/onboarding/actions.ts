'use server'

import { requireManager } from '@/lib/auth'
import { createPlan, commitGroup, planById, hasLiveData, DESTRUCTIVE_GROUPS, type PlanGroup } from '@/lib/onboarding'
import { PLAN_GROUPS } from '@/lib/onboarding'
import { revalidatePath } from 'next/cache'

// C6 · Generate, then commit group by group.
//
// Reading the edited values out of the form rather than the stored plan is the
// point of the whole screen: what the owner corrected is what gets written.

export async function generate(data: FormData) {
  await requireManager()
  await createPlan(String(data.get('description') ?? ''))
  revalidatePath('/admin/onboarding')
}

const s = (data: FormData, key: string) => String(data.get(key) ?? '').trim()
const n = (data: FormData, key: string) => Number(data.get(key) ?? 0)

/** Repeated fields arrive as parallel arrays: name[], price[], … */
function rows(data: FormData, keys: string[]): Record<string, string>[] {
  const columns = keys.map(k => data.getAll(k).map(String))
  const length = Math.max(0, ...columns.map(c => c.length))
  return Array.from({ length }, (_, i) =>
    Object.fromEntries(keys.map((k, ki) => [k, (columns[ki][i] ?? '').trim()])))
}

export async function commit(data: FormData) {
  await requireManager()
  const planId = s(data, 'planId')
  const group = s(data, 'group') as PlanGroup
  if (!(PLAN_GROUPS as readonly string[]).includes(group)) return

  const stored = await planById(planId)
  if (!stored) return

  // Overwriting identity, colours or voice on an instance that already has
  // customers needs saying out loud. The catalogue groups are additive and do
  // not, which is why the gate is per-group rather than on the whole screen.
  if (DESTRUCTIVE_GROUPS.includes(group) && (await hasLiveData()) && s(data, 'confirm') !== 'yes') return

  const edited = { ...stored.plan }

  switch (group) {
    case 'business':
      edited.business = {
        name: s(data, 'name'), tagline: s(data, 'tagline'), phone: s(data, 'phone'),
        address: s(data, 'address'), email: s(data, 'email'),
        currencyCode: s(data, 'currencyCode'), currencySymbol: s(data, 'currencySymbol'),
        locale: s(data, 'locale'), timezone: s(data, 'timezone'),
        openHour: n(data, 'openHour'), closeHour: n(data, 'closeHour'),
      }
      break
    case 'brand':
      edited.brand = { primary: s(data, 'primary'), ink: s(data, 'ink') }
      break
    case 'voice':
      edited.voice = {
        tone: s(data, 'tone'), languages: s(data, 'languages'), emoji: s(data, 'emoji'),
        signature: s(data, 'signature'), avoid: s(data, 'avoid'),
      }
      break
    case 'services':
      edited.services = rows(data, ['sName', 'sCategory', 'sDuration', 'sPrice'])
        .filter(r => r.sName)
        .map(r => ({ name: r.sName, category: r.sCategory, durationMin: Number(r.sDuration), price: Number(r.sPrice) }))
      break
    case 'rooms':
      edited.rooms = rows(data, ['rName', 'rType', 'rCapacity'])
        .filter(r => r.rName)
        .map(r => ({ name: r.rName, type: r.rType, capacity: Number(r.rCapacity) }))
      break
    case 'tiers':
      edited.tiers = rows(data, ['tName', 'tTagline', 'tQualification', 'tThreshold', 'tMultiplier'])
        .filter(r => r.tName)
        .map(r => ({
          name: r.tName, tagline: r.tTagline, qualification: r.tQualification,
          annualSpendThreshold: r.tThreshold ? Number(r.tThreshold) : null,
          pointsMultiplier: Number(r.tMultiplier) || 1,
          benefits: stored.plan.tiers.find(t => t.name === r.tName)?.benefits ?? [],
        }))
      break
    case 'templates':
      edited.templates = rows(data, ['mType', 'mLabel', 'mBody'])
        .filter(r => r.mLabel && r.mBody)
        .map(r => ({ type: r.mType, label: r.mLabel, body: r.mBody }))
      break
  }

  await commitGroup(planId, group, edited)
  revalidatePath('/admin/onboarding')
  revalidatePath('/admin/settings')
}
