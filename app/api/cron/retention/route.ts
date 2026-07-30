import { NextResponse } from 'next/server'
import { purgeExpiredCustomers } from '@/lib/retention'
import { safeEqual } from '@/lib/http-security'
import { getSession, isManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

// Retention purge (A3, step 2). Hard-deletes anonymised customers whose newest
// financial record has aged past data.retentionYears. Runs on a schedule (Vercel
// Cron → GET with Bearer CRON_SECRET) and can be triggered by a signed-in
// manager. Fail-closed.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (secret && auth.startsWith('Bearer ') && safeEqual(auth.slice(7), secret)) return true
  return isManager(await getSession())
}

async function run(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await purgeExpiredCustomers()
    if (result.purged > 0) {
      await recordAudit({
        action: 'customer.purge',
        entityType: 'Customer',
        entityId: result.ids.join(','),
        summary: `Retention purge removed ${result.purged} anonymised customer(s) past the ${result.retentionYears}-year window`,
        detail: { purged: result.purged, ids: result.ids, retentionYears: result.retentionYears },
      })
    }
    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (e) {
    console.error('retention cron failed', e)
    return NextResponse.json({ ok: false, error: 'Retention purge failed' }, { status: 500 })
  }
}

export const GET = run   // Vercel Cron
export const POST = run  // manual "purge now"
