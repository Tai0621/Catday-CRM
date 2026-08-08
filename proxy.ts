import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { roleHome, staffCanAccess } from './lib/roles'

// Paths the cookie gate skips because they authenticate themselves:
//  • '/api/cron' — Vercel Cron (Bearer CRON_SECRET) has no cookie; the route
//    does its own strict Bearer-or-manager check, so gating it here would only
//    break the scheduled run.
//  • webhooks — signed by the caller (HMAC / shared secret).
//  • '/r/' — the public digital-receipt link (unguessable token) customers open
//    from WhatsApp. The trailing slash keeps it from matching /revenue etc.
//  • '/api/health' — public liveness probe for uptime monitors.
//  • '/careers' + '/api/careers' — the public job-application form.
//  • '/visit' + '/api/visit' — the public presence page and its booking-request
//    form (M6). Both 404 when the tenant has not published the page.
//  • '/sitemap.xml' + '/robots.txt' — crawler-facing; they answer with nothing
//    at all unless the page is published on a production deployment.
const PUBLIC_PATHS = ['/login', '/api/login', '/api/whatsapp', '/api/google-forms', '/api/cron', '/api/health', '/careers', '/api/careers', '/visit', '/api/visit', '/sitemap.xml', '/robots.txt', '/r/', '/review/', '/privacy']

// Paths only managers (owner password or Manager-role staff) may open.
// Staff hitting these are sent to their service board.
const MANAGER_PATHS = [
  '/revenue', '/plan', '/academy', '/ask', '/api/ask', '/whatsapp', '/brief', '/reports',
  '/staff', '/services', '/cashup', '/memberships/tiers', '/finance', '/admin', '/hr', '/products',
  '/api/customers', '/marketing',
]

// Edge-runtime mirror of lib/auth's v3 token check (Web Crypto, no node:crypto).
// Must stay in lockstep with makeSessionToken/parseSessionToken there.
function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
}
function sessionEpoch(): string {
  return process.env.SESSION_EPOCH || '1'
}
async function hmacHex(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(sessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v3:${payloadB64}`))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
function b64urlDecode(s: string): string {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  return atob(std + '='.repeat((4 - (std.length % 4)) % 4))
}

type TokenInfo = { valid: boolean; role: string }

async function checkToken(token: string): Promise<TokenInfo> {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v3') return { valid: false, role: '' }
  if (!ctEqual(parts[2], await hmacHex(parts[1]))) return { valid: false, role: '' }
  try {
    const p = JSON.parse(b64urlDecode(parts[1]))
    if (typeof p.exp !== 'number' || Date.now() > p.exp) return { valid: false, role: '' }
    if ((p.ep ?? '1') !== sessionEpoch()) return { valid: false, role: '' }
    const role = p.kind === 'manager' ? 'Manager' : (p.role ?? '')
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
    // Two gates for staff: the manager-only denylist (blocks everyone who isn't
    // a manager), then the per-role allow-list (default-deny). Anything the role
    // may not open — including '/' — bounces to that role's home screen.
    const home = roleHome(info.role)
    const managerOnly = MANAGER_PATHS.some(p => pathname.startsWith(p))
    const blocked = pathname === '/' || managerOnly || !staffCanAccess(info.role, pathname)
    if (blocked && pathname !== home) {
      return NextResponse.redirect(new URL(home, req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Skip Next internals and static assets (images/fonts/icons) so the login
  // logo and other public files serve without an auth redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)'],
}
