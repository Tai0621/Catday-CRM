import { NextResponse } from 'next/server'
import { hashPassword, makeSessionToken } from '@/lib/auth'
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

  if (provided && provided === (process.env.APP_PASSWORD ?? '')) {
    token = makeSessionToken({ kind: 'manager', name: 'Owner' })
  } else if (provided) {
    const staff = await db.staff.findFirst({
      where: { pinHash: hashPassword(provided), active: true },
    })
    if (staff) {
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
