import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { normalisePhone } from '@/lib/phone'
import { countRequest } from '@/lib/public/presence'

// M6 · Public booking-request submit. No auth (see proxy PUBLIC_PATHS).
//
// Writes a BookingRequest, never an Appointment: a stranger must not be able to
// put anything in the diary. Follows the /api/careers pattern — honeypot,
// required name + phone, 303 back to the page.

const MAX_PER_PHONE_PER_DAY = 5
const DAY = 24 * 60 * 60 * 1000

const back = (req: Request, qs: string) => NextResponse.redirect(new URL(`/visit?${qs}`, req.url), 303)

export async function POST(req: Request) {
  const config = await getConfig()
  // A disabled page must not leave a live write endpoint behind it.
  if (!config.publicPage.enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data = await req.formData()
  const str = (k: string, max = 200) => ((data.get(k) as string) ?? '').trim().slice(0, max)

  // Bot — pretend it worked rather than teaching it what failed.
  if (str('company')) return back(req, 'sent=1')

  const name = str('name', 80)
  const rawPhone = str('phone', 40)
  if (!name || !rawPhone) return back(req, 'error=1')
  const phone = normalisePhone(rawPhone)

  // Cheap flood guard. The honeypot stops the naive bots; this stops one
  // determined person turning the enquiry list into a wall of noise.
  const recent = await db.bookingRequest.count({
    where: { phone, createdAt: { gte: new Date(Date.now() - DAY) } },
  })
  if (recent >= MAX_PER_PHONE_PER_DAY) return back(req, 'sent=1')

  const preferred = str('preferredDate', 10)
  await db.bookingRequest.create({
    data: {
      name,
      phone,
      email: str('email', 120) || null,
      catName: str('catName', 60) || null,
      serviceName: str('serviceName', 80) || null,
      preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(preferred) ? preferred : null,
      notes: str('notes', 600) || null,
    },
  })
  await countRequest(config.timezone)

  return back(req, 'sent=1')
}
