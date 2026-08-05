'use server'

import { getConfig } from '@/lib/config'
import { recordResponse, recordClick } from '@/lib/reviews'
import { redirect } from 'next/navigation'

// File-level rather than inline in the page: this route has more than one
// mutation, which is the repo's threshold for a colocated actions.ts, and it
// keeps them drivable by the verification scripts.

export async function answerReview(data: FormData) {
  const token = String(data.get('token') ?? '')
  const sentiment = String(data.get('sentiment') ?? '')
  if (!token || (sentiment !== 'Positive' && sentiment !== 'Negative')) return

  await recordResponse(token, sentiment, String(data.get('detail') ?? ''))
  redirect(`/review/${token}?state=${sentiment === 'Positive' ? 'thanks' : 'sorry'}`)
}

export async function goToReview(data: FormData) {
  const token = String(data.get('token') ?? '')
  if (!token) return
  await recordClick(token)
  const cfg = await getConfig()
  const url = cfg.marketing.reviewUrl.trim()
  // Never redirect to an empty string — that would land on the site root.
  redirect(url || `/review/${token}?state=thanks`)
}
