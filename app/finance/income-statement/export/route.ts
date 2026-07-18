import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { buildIncomeStatement, statementToCsv } from '@/lib/finance'

// Downloadable income statement — CSV opens directly in Excel.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Manager sign-in required' }, { status: 401 })
  }

  const yearParam = req.nextUrl.searchParams.get('year') ?? ''
  const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear()

  const statement = await buildIncomeStatement(year)
  // BOM so Excel opens it as UTF-8 without an import wizard
  const csv = '﻿' + statementToCsv(statement)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="CATDAY-Income-Statement-${year}.csv"`,
    },
  })
}
