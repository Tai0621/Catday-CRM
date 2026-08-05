'use server'

import { requireManager } from '@/lib/auth'
import { creditReferral, findByCode, linkReferral, referralCodeFor } from '@/lib/referrals'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PAGE = '/marketing/referrals'
const back = (code?: string) => redirect(code ? `${PAGE}?msg=${encodeURIComponent(code)}` : PAGE)

export async function creditReferralAction(data: FormData) {
  await requireManager()
  const id = String(data.get('id') ?? '')
  if (!id) return
  const res = await creditReferral(id)
  revalidatePath(PAGE)
  if (!res.ok) back(res.error)
}

export async function linkReferralAction(data: FormData) {
  await requireManager()
  const code = String(data.get('code') ?? '').trim()
  const referredId = String(data.get('referredId') ?? '').trim()
  if (!code || !referredId) return

  const referrer = await findByCode(code)
  if (!referrer) back('no-such-code')
  const res = await linkReferral(referrer!.id, referredId)
  revalidatePath(PAGE)
  if (!res.ok) back(res.error)
}

export async function issueCodeAction(data: FormData) {
  await requireManager()
  const customerId = String(data.get('customerId') ?? '')
  if (!customerId) return
  await referralCodeFor(customerId)
  revalidatePath(PAGE)
}
