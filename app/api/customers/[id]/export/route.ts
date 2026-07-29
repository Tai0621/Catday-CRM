import { NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { buildCustomerExport, exportFilename } from '@/lib/data-export'

// GET /api/customers/[id]/export — the data-subject access bundle (A2).
// Manager-only (defence in depth: also gated by MANAGER_PATHS in proxy.ts).
// Returns the complete customer record as a downloadable JSON attachment and
// records the disclosure in the audit trail.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!isManager(session)) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 })
  }

  const { id } = await params
  const data = await buildCustomerExport(id)
  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  await recordAudit({
    action: 'customer.export',
    entityType: 'Customer',
    entityId: id,
    summary: `Exported customer data (${data.counts.transactions} txns, ${data.counts.cats} cats, ${data.counts.media} media)`,
    detail: data.counts,
  }, session)

  const filename = exportFilename(data.profile)
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
