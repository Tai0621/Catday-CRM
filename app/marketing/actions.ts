'use server'

import { db } from '@/lib/db'
import { requireManager, getSession } from '@/lib/auth'
import { canMessage } from '@/lib/customer-groups'
import { revalidatePath } from 'next/cache'

// One place a customer message is recorded as sent, shared by the M10 group
// worklist and the copilot's confirm gate (C2).
//
// The record is what the frequency cap and M2's attribution read, so a second
// send surface that wrote its own row — or wrote none — would quietly uncap
// the business. Every outreach goes through here.

export type SendResult = { ok: true; id: string } | { ok: false; error: string }

// The key a one-off copilot-drafted message is filed under lives in
// lib/constants (AD_HOC_GROUP_KEY): a 'use server' module may only export async
// functions, so a constant declared here would silently void every export in
// the file.
export async function logSend(customerId: string, groupKey: string, variant?: string | null): Promise<SendResult> {
  await requireManager()

  const gate = await canMessage(customerId)
  if (!gate.ok) return { ok: false, error: gate.reason }

  const session = await getSession()
  const send = await db.groupSend.create({
    data: {
      groupKey,
      customerId,
      channel: 'WhatsApp',
      variant: variant ?? null,
      staffId: session?.kind === 'staff' ? session.staffId : null,
    },
  })

  revalidatePath(`/marketing/groups/${groupKey}`)
  return { ok: true, id: send.id }
}
