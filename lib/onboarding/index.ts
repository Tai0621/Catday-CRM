import { db } from '../db'
import { EXPENSE_CATEGORIES } from '../finance-categories'
import { generatePlan, TEMPLATE_TYPES } from './generate'
import { normalisePlan, PLAN_GROUPS, groupCount, type OnboardingPlan, type PlanGroup } from './plan'
import {
  commitServices, commitRooms, commitTiers, commitTemplates,
  commitBusiness, commitBrand, commitVoice,
  hasLiveData, auditCommit, DESTRUCTIVE_GROUPS, type CommitResult,
} from './commit'

export { PLAN_GROUPS, groupCount, type OnboardingPlan, type PlanGroup }
export { TEMPLATE_TYPES }
export { hasLiveData, DESTRUCTIVE_GROUPS, type CommitResult }

export interface StoredPlan {
  id: string
  createdAt: Date
  description: string
  plan: OnboardingPlan
  committed: PlanGroup[]
}

function hydrate(row: { id: string; createdAt: Date; description: string; plan: string; committed: string }): StoredPlan {
  return {
    id: row.id,
    createdAt: row.createdAt,
    description: row.description,
    // Re-normalised on read: a plan stored before a validation rule tightened
    // must not slip past the new rule just because it is already in a row.
    plan: normalisePlan(JSON.parse(row.plan), TEMPLATE_TYPES),
    committed: JSON.parse(row.committed) as PlanGroup[],
  }
}

export type CreateResult =
  | { ok: true; plan: StoredPlan }
  | { ok: false; reason: 'no-key' | 'ai-disabled' | 'empty' | 'failed'; detail?: string }

export async function createPlan(description: string): Promise<CreateResult> {
  const text = description.trim()
  if (text.length < 20) return { ok: false, reason: 'empty' }

  try {
    const { plan, model, inputTokens, outputTokens } = await generatePlan(text, EXPENSE_CATEGORIES)
    const row = await db.onboardingPlan.create({
      data: { description: text, plan: JSON.stringify(plan), model, inputTokens, outputTokens },
    })
    return { ok: true, plan: hydrate(row) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'no-key') return { ok: false, reason: 'no-key' }
    if (msg === 'ai-disabled') return { ok: false, reason: 'ai-disabled' }
    if (msg === 'empty-plan') return { ok: false, reason: 'empty' }
    console.error('onboarding plan failed:', msg)
    return { ok: false, reason: 'failed', detail: msg }
  }
}

export async function latestPlan(): Promise<StoredPlan | null> {
  const row = await db.onboardingPlan.findFirst({ orderBy: { createdAt: 'desc' } })
  return row ? hydrate(row) : null
}

export async function planById(id: string): Promise<StoredPlan | null> {
  const row = await db.onboardingPlan.findUnique({ where: { id } })
  return row ? hydrate(row) : null
}

/**
 * Apply one group, using the values passed in — which are the EDITED ones from
 * the form, not the stored proposal. The stored plan is a record of what was
 * suggested; what gets written is what the owner saw and approved.
 */
export async function commitGroup(
  planId: string,
  group: PlanGroup,
  edited: OnboardingPlan,
): Promise<CommitResult> {
  const result = await (async (): Promise<CommitResult> => {
    switch (group) {
      case 'services': return commitServices(edited.services)
      case 'rooms': return commitRooms(edited.rooms)
      case 'tiers': return commitTiers(edited.tiers)
      case 'templates': return commitTemplates(edited.templates)
      case 'business': return commitBusiness(edited.business)
      case 'brand': return commitBrand(edited.brand)
      case 'voice': return commitVoice(edited.voice)
    }
  })()

  const row = await db.onboardingPlan.findUnique({ where: { id: planId }, select: { committed: true, plan: true } })
  if (row) {
    const committed = new Set(JSON.parse(row.committed) as string[])
    committed.add(group)
    // The stored plan is updated to the edited values too, so re-opening the
    // page shows what was actually committed rather than the original guess.
    const stored = JSON.parse(row.plan) as OnboardingPlan
    await db.onboardingPlan.update({
      where: { id: planId },
      data: {
        committed: JSON.stringify([...committed]),
        plan: JSON.stringify({ ...stored, [group]: edited[group as keyof OnboardingPlan] }),
      },
    })
  }

  await auditCommit(result, planId)
  return result
}
