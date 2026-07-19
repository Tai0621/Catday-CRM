import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { buildCashFlow, cashFlowToCsv } from '@/lib/cash-flow'
import { monthKey } from '@/lib/plan'

// Downloadable cash flow statement — CSV opens directly in Excel.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Manager sign-in required' }, { status: 401 })
  }
  const toParam = req.nextUrl.searchParams.get('to') ?? ''
  const to = /^\d{4}-\d{2}$/.test(toParam) ? toParam : monthKey(new Date())
  const from = `${Number(to.slice(0, 4)) - 1}-12`
  const cf = await buildCashFlow(from, to)
  const csv = '﻿' + cashFlowToCsv(cf)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="CATDAY-Cash-Flow-${to}.csv"`,
    },
  })
}
