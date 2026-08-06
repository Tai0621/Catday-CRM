'use server'

import { requireManager } from '@/lib/auth'
import { generateBrief, pendingBriefDay } from '@/lib/brief'
import { revalidatePath } from 'next/cache'

// Manual trigger for the nightly brief — for the morning after a missed cron,
// or the first run on a new deployment. Same function the scheduled job calls,
// and idempotent by date, so pressing it twice costs one call.

export async function generateBriefNow(data: FormData) {
  await requireManager()
  const requested = String(data.get('date') ?? '')
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : await pendingBriefDay()
  await generateBrief(dayKey)
  revalidatePath('/brief')
  revalidatePath('/')
}
