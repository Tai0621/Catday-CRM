import { NextResponse } from 'next/server'
import { runBackupToBlob } from '@/lib/backup'
import { safeEqual } from '@/lib/http-security'
import { getSession, isManager } from '@/lib/auth'

// Database backup → Vercel Blob. Runs on a schedule (Vercel Cron → GET with
// Bearer CRON_SECRET) and can be triggered on demand by a signed-in manager.
// Fail-closed: nothing else gets in.
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
    const result = await runBackupToBlob()
    return NextResponse.json(result, { status: result.ok ? 200 : 503 })
  } catch (e) {
    console.error('backup cron failed', e)
    return NextResponse.json({ ok: false, error: 'Backup failed' }, { status: 500 })
  }
}

export const GET = run   // Vercel Cron
export const POST = run  // manual "back up now"
