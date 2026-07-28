import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Public liveness/readiness probe for uptime monitors and deploy checks.
// 200 when the database is reachable, 503 when it isn't. Intentionally leaks
// nothing sensitive — just up/down, the build sha, and process uptime.
export const dynamic = 'force-dynamic'

export async function GET() {
  let dbOk = false
  try {
    await db.setting.count()
    dbOk = true
  } catch (e) {
    console.error('health: db check failed', e)
  }
  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'up' : 'down',
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  )
}
