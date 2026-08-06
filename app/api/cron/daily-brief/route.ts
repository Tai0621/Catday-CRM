import { NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { safeEqual } from '@/lib/http-security'
import { generateBrief, pendingBriefDay, buildBriefFacts } from '@/lib/brief'
import { zonedDayKey } from '@/lib/timezone'
import { getConfig } from '@/lib/config'

// C5 · The nightly analyst brief.
//
// Scheduled just after local midnight (vercel.json) so the day it reports on is
// actually finished. Same fail-closed authorisation as eod-analysis: the cron
// carries CRON_SECRET, a manager session may trigger it by hand, nothing else
// gets in — this endpoint spends tokens.

async function authorized(req: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (cronSecret && auth.startsWith('Bearer ') && safeEqual(auth.slice(7), cronSecret)) return true
  return isManager(await getSession())
}

export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A specific day may be requested by a manager (backfilling a missed night);
  // the scheduled run always takes the day that just ended.
  const requested = new URL(req.url).searchParams.get('date')
  const { timezone } = await getConfig()
  const valid = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
  const today = zonedDayKey(new Date(), timezone)
  if (requested && !valid) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  // A brief for a day still in progress would be wrong and, being unique by
  // date, would then block the real one.
  if (valid && requested >= today) {
    return NextResponse.json({ error: 'that day has not finished yet' }, { status: 400 })
  }

  const dayKey = valid ? requested : await pendingBriefDay()

  // What tonight's brief would be written from, without writing it or spending
  // anything. This is how a figure that looks wrong gets checked — the answer
  // is nearly always in the facts rather than in the narration.
  if (new URL(req.url).searchParams.get('dryRun') === '1') {
    return NextResponse.json({ date: dayKey, dryRun: true, facts: await buildBriefFacts(dayKey) })
  }

  const result = await generateBrief(dayKey)

  if (!result.ok) {
    // Not an error condition for the scheduler: a tenant with no key or AI
    // switched off should not produce a failing cron every night.
    const skipped = result.reason === 'no-key' || result.reason === 'ai-disabled'
    return NextResponse.json(
      { date: dayKey, written: false, reason: result.reason, detail: result.detail },
      { status: skipped ? 200 : 500 },
    )
  }

  return NextResponse.json({
    date: dayKey,
    written: !result.reused,
    reused: result.reused,
    observations: result.brief.observations.length,
    actions: result.brief.actions.length,
  })
}

export async function GET(req: Request) {
  // Vercel Cron calls GET with the bearer token; POST re-checks it.
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
