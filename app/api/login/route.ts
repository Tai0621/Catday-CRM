import { NextResponse } from 'next/server'
import { verifyPassword, hashPassword, needsRehash, makeSessionToken } from '@/lib/auth'
import { safeEqual } from '@/lib/http-security'
import { roleHome } from '@/lib/roles'
import { db } from '@/lib/db'
import { cookies } from 'next/headers'

// One field, two doors: the owner password opens the management view,
// a personal staff PIN opens that person's staff view.
export async function POST(req: Request) {
  const data = await req.formData()
  const provided = ((data.get('password') as string) ?? '').trim()

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
      landing = roleHome(staff.role)
    }
  }

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=1', req.url))
  }

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
