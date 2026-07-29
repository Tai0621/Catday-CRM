import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalisePhone } from '@/lib/phone'

// Public careers-form submit. No auth (see proxy PUBLIC_PATHS). A hidden
// honeypot field silently drops bots; name + phone are required.
export async function POST(req: Request) {
  const data = await req.formData()

  if (((data.get('company') as string) ?? '').trim()) {
    return NextResponse.redirect(new URL('/careers?sent=1', req.url), 303) // bot — pretend success
  }

  const name = ((data.get('name') as string) ?? '').trim()
  const phone = ((data.get('phone') as string) ?? '').trim()
  if (!name || !phone) {
    return NextResponse.redirect(new URL('/careers?error=1', req.url), 303)
  }

  const str = (k: string) => (((data.get(k) as string) ?? '').trim() || null)
  await db.jobApplication.create({
    data: {
      name,
      phone: normalisePhone(phone),
      email: str('email'),
      roleApplied: str('roleApplied'),
      experience: str('experience'),
      availability: str('availability'),
    },
  })

  return NextResponse.redirect(new URL('/careers?sent=1', req.url), 303)
}
