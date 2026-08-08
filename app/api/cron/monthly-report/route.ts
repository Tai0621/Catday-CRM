import { NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { safeEqual } from '@/lib/http-security'
import { generateMonth, generateReport, previousMonth, currentMonth, isMonthKey, departmentByKey, type DepartmentKey } from '@/lib/reports'
import { buildDepartmentFacts } from '@/lib/reports/facts'

// C9 · Monthly department reports. Runs on the 1st for the month just closed.
// Six Haiku calls a month. Same fail-closed authorisation as the other jobs
// that spend tokens.

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

  const params = new URL(req.url).searchParams
  const requested = params.get('month')
  if (requested && !isMonthKey(requested)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const month = requested ?? previousMonth()
  // A month still running would be reported half-finished and, being unique on
  // (month, department), would then occupy the slot the real report needs.
  if (month >= currentMonth()) {
    return NextResponse.json({ error: 'that month has not closed yet' }, { status: 400 })
  }

  const deptParam = params.get('department')
  if (deptParam && !departmentByKey(deptParam)) {
    return NextResponse.json({ error: `unknown department ${deptParam}` }, { status: 400 })
  }

  // The figures a report would be built from, without writing or spending.
  if (params.get('dryRun') === '1') {
    if (!deptParam) return NextResponse.json({ error: 'dryRun needs a department' }, { status: 400 })
    return NextResponse.json({
      month, department: deptParam, dryRun: true,
      facts: await buildDepartmentFacts(deptParam as DepartmentKey, month),
    })
  }

  const renarrate = params.get('renarrate') === '1'
  const reports = deptParam
    ? [await generateReport(deptParam as DepartmentKey, month, { renarrate })]
    : await generateMonth(month, { renarrate })

  return NextResponse.json({
    month,
    generated: reports.length,
    reports: reports.map(r => ({
      department: r.department,
      status: r.status,
      unsupported: r.unsupported.length ? r.unsupported : undefined,
    })),
  })
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
