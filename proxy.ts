import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/login', '/api/whatsapp', '/api/google-forms']

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get('auth')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const expected = await sha256Hex(`catday:${process.env.APP_PASSWORD ?? ''}`)

  if (token !== expected) {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('auth')
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
