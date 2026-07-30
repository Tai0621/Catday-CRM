import { NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { anonymizeCustomer } from '@/lib/retention'

// POST /api/customers/[id]/erase — anonymise a customer on an erasure request
// (A3, step 1). Manager-only (also gated by MANAGER_PATHS in proxy.ts). Redacts
// identifying data + deletes media while keeping de-identified financial rows;
// audit-logged; redirects back to the (now redacted) customer page.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!isManager(session)) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 })
  }

  const { id } = await params
  const result = await anonymizeCustomer(id)
  if (!result) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  await recordAudit({
    action: 'customer.erase',
    entityType: 'Customer',
    entityId: id,
    summary: `Erased customer (anonymised — ${result.cleared.cats} cats, ${result.cleared.media} media, ${result.cleared.whatsappLeads} WhatsApp cleared)`,
    detail: result.cleared,
  }, session)

  return NextResponse.redirect(new URL(`/customers/${id}`, req.url), { status: 303 })
}
