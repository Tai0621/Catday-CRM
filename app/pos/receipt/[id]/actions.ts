'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Record that the digital receipt was shared, so the owner can see which sales
// got one. wa.me is fire-and-forget (we can't know the customer received it),
// so this marks intent at the moment staff taps send.
export async function markReceiptSent(id: string, channel: 'WhatsApp' | 'Email'): Promise<void> {
  const session = await getSession()
  if (!session) return
  await db.transaction.update({
    where: { id },
    data: { receiptSentAt: new Date(), receiptChannel: channel },
  })
  revalidatePath(`/pos/receipt/${id}`)
}
