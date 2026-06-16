import { NextResponse } from 'next/server'
import { hashPassword } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  const data = await req.formData()
  const password = data.get('password') as string

  const expected = hashPassword(process.env.APP_PASSWORD ?? '')
  const provided = hashPassword(password)

  if (provided !== expected) {
    return NextResponse.redirect(new URL('/login?error=1', req.url))
  }

  const jar = await cookies()
  jar.set('auth', provided, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })

  return NextResponse.redirect(new URL('/', req.url))
}
