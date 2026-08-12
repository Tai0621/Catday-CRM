import { NextResponse } from 'next/server'
import { verifyPassword, hashPassword, needsRehash, makeSessionToken } from '@/lib/auth'
import { safeEqual } from '@/lib/http-security'
import { isLoginBlocked, recordLoginFailure, clearLoginFailures } from '@/lib/rate-limit'
import { homeFor } from '@/lib/roles-store'
import { db } from '@/lib/db'
import { cookies } from 'next/headers'

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}

// One field, two doors: the owner password opens the management view,
// a personal staff PIN opens that person's staff view.
export async function POST(req: Request) {
  const data = await req.formData()
  const provided = ((data.get('password') as string) ?? '').trim()
  const ip = clientIp(req)

  // Throttle brute force: too many recent failed attempts from this IP → refuse.
  if (await isLoginBlocked(ip)) {
    return NextResponse.redirect(new URL('/login?error=rate', req.url))
  }

  let token: string | null = null
  let landing = '/'

  const appPassword = process.env.APP_PASSWORD ?? ''
  if (provided && appPassword && safeEqual(provided, appPassword)) {
    token = makeSessionToken({ kind: 'manager', name: 'Owner' })
  } else if (provided) {
    // PINs are salted now, so we can't look up by a deterministic hash — verify
    // the PIN against each active staff member's stored hash.
    const staffList = await db.staff.findMany({ where: { active: true } })
    const staff = staffList.find(s => verifyPassword(provided, s.pinHash))
    if (staff) {
      // Transparently upgrade a legacy sha256 PIN to salted scrypt on login.
      if (needsRehash(staff.pinHash)) {
        await db.staff.update({ where: { id: staff.id }, data: { pinHash: hashPassword(provided) } }).catch(() => {})
      }
      token = makeSessionToken({ kind: 'staff', staffId: staff.id, name: staff.name, role: staff.role })
      landing = await homeFor(staff.role)
    }
  }

  if (!token) {
    await recordLoginFailure(ip)
    return NextResponse.redirect(new URL('/login?error=1', req.url))
  }

  await clearLoginFailures(ip) // legitimate login — reset the failure counter

  const jar = await cookies()
  jar.set('auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })

  return NextResponse.redirect(new URL(landing, req.url))
}
