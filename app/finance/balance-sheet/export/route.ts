import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { buildBalanceSheet, balanceSheetToCsv } from '@/lib/balance-sheet'
import { monthKey } from '@/lib/plan'

// Downloadable balance sheet — CSV opens directly in Excel.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Manager sign-in required' }, { status: 401 })
  }
  const asOfParam = req.nextUrl.searchParams.get('asOf') ?? ''
  const asOf = /^\d{4}-\d{2}$/.test(asOfParam) ? asOfParam : monthKey(new Date())
  const bs = await buildBalanceSheet(asOf)
  const csv = '﻿' + balanceSheetToCsv(bs)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="CATDAY-Balance-Sheet-${asOf}.csv"`,
    },
  })
}
