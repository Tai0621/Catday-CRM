import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/login', '/api/whatsapp', '/api/google-forms']

// Paths only managers (owner password or Manager-role staff) may open.
// Staff hitting these are sent to their service board.
const MANAGER_PATHS = [
  '/revenue', '/plan', '/academy', '/ask', '/api/ask', '/whatsapp',
  '/staff', '/services', '/cashup', '/memberships/tiers', '/finance',
]

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

type TokenInfo = { valid: boolean; role: string }

async function checkToken(token: string): Promise<TokenInfo> {
  const pw = process.env.APP_PASSWORD ?? ''
  // Legacy cookie: plain password hash = manager
  if (token === await sha256Hex(`catday:${pw}`)) return { valid: true, role: 'Manager' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v2') return { valid: false, role: '' }
  const expected = await sha256Hex(`catday-session:${parts[1]}:${pw}`)
  if (parts[2] !== expected) return { valid: false, role: '' }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const session = JSON.parse(atob(b64))
    const role = session.kind === 'manager' ? 'Manager' : (session.role ?? '')
    return { valid: true, role }
  } catch {
    return { valid: false, role: '' }
  }
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

  const info = await checkToken(token)
  if (!info.valid) {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('auth')
    return res
  }

  if (info.role !== 'Manager') {
    const managerOnly = pathname === '/' || MANAGER_PATHS.some(p => pathname.startsWith(p))
    if (managerOnly) {
      return NextResponse.redirect(new URL('/board', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Skip Next internals and static assets (images/fonts/icons) so the login
  // logo and other public files serve without an auth redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)'],
}
