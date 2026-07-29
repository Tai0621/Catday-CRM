'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getHrConfig, checkOnPremise, clientIp } from '@/lib/hr'

export type ClockResult = { ok: true } | { ok: false; error: string }

async function requestIp(): Promise<string | null> {
  return clientIp((await headers()).get('x-forwarded-for'))
}

export async function clockIn(photoId?: string | null): Promise<ClockResult> {
  const s = await getSession()
  if (s?.kind !== 'staff') return { ok: false, error: 'Clock-in is for staff accounts.' }

  const open = await db.timeEntry.findFirst({ where: { staffId: s.staffId, clockOutAt: null } })
  if (open) return { ok: false, error: 'You are already clocked in.' }

  const ip = await requestIp()
  const { allowedIps, enforceOnPremise } = await getHrConfig()
  const onPremise = checkOnPremise(ip, allowedIps)
  if (enforceOnPremise && onPremise === false) {
    return { ok: false, error: 'You can only clock in at the shop.' }
  }

  await db.timeEntry.create({
    data: { staffId: s.staffId, clockInIp: ip, onPremiseIn: onPremise, clockInPhotoId: photoId ?? null },
  })
  revalidatePath('/timeclock')
  return { ok: true }
}

export async function clockOut(photoId?: string | null): Promise<ClockResult> {
  const s = await getSession()
  if (s?.kind !== 'staff') return { ok: false, error: 'Clock-out is for staff accounts.' }

  const open = await db.timeEntry.findFirst({ where: { staffId: s.staffId, clockOutAt: null }, orderBy: { clockInAt: 'desc' } })
  if (!open) return { ok: false, error: 'You are not clocked in.' }

  const ip = await requestIp()
  const { allowedIps } = await getHrConfig()
  // Don't block clock-out on location — you might already have left the shop.
  await db.timeEntry.update({
    where: { id: open.id },
    data: { clockOutAt: new Date(), clockOutIp: ip, onPremiseOut: checkOnPremise(ip, allowedIps), clockOutPhotoId: photoId ?? null },
  })
  revalidatePath('/timeclock')
  return { ok: true }
}
