import { cookies } from 'next/headers'
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { safeEqual } from './http-security'

// ── Sessions ─────────────────────────────────────────────────────────────────
// Two kinds of login share one cookie:
//   manager  — the owner password (APP_PASSWORD)
//   staff    — a personal PIN from the Staff table; role decides what they see
// Token format: "v3.<base64url payload>.<HMAC-SHA256 signature>". The payload
// carries iat/exp (hard 30-day expiry) and ep (a global epoch); the token is
// signed with SESSION_SECRET (falling back to APP_PASSWORD until it's set).
// Bumping SESSION_EPOCH or rotating either secret invalidates every session.

export type Session =
  | { kind: 'manager'; name: string }
  | { kind: 'staff'; staffId: string; name: string; role: string }

// ── Password / PIN hashing — salted scrypt ───────────────────────────────────
// Stored as `scrypt$N$r$p$saltHex$hashHex` (self-describing so params can move).
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const dk = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${dk.toString('hex')}`
}

function legacyHash(password: string): string {
  return createHash('sha256').update(`catday:${password}`).digest('hex')
}

/** Verify a plaintext against a stored hash (salted scrypt, or legacy sha256). */
export function verifyPassword(password: string, stored: string): boolean {
  // A hash that does not parse must not MATCH, and must not THROW.
  //
  // This runs inside a `find` over every active staff member (app/api/login),
  // so an exception here is not one account failing to sign in — it is a 500
  // for the whole login route, and nobody on a PIN can get in. That happened:
  // an interrupted verification run left three staff rows carrying a
  // placeholder `scrypt$ph$<id>`, and `Buffer.from(undefined, 'hex')` threw on
  // every attempt until they were deleted. Returning false keeps the blast
  // radius at the corrupt row.
  if (!stored) return false

  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$')
    if (parts.length !== 6) return false
    const [, N, r, p, saltHex, hashHex] = parts
    if (!saltHex || !hashHex) return false
    if (![N, r, p].every(v => Number.isInteger(+v) && +v > 0)) return false
    const want = Buffer.from(hashHex, 'hex')
    if (want.length === 0) return false
    const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), want.length, { N: +N, r: +r, p: +p })
    return dk.length === want.length && timingSafeEqual(dk, want)
  }
  return safeEqual(legacyHash(password), stored) // legacy unsalted — caller should re-hash
}

/** True when a stored hash is legacy and should be upgraded on next login. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith('scrypt$')
}

// ── Session tokens ────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
}
export function sessionEpoch(): string {
  return process.env.SESSION_EPOCH || '1'
}
function sign(payloadB64: string): string {
  return createHmac('sha256', sessionSecret()).update(`v3:${payloadB64}`).digest('hex')
}

type TokenPayload = Session & { iat: number; exp: number; ep: string }

export function makeSessionToken(session: Session): string {
  const now = Date.now()
  const payload: TokenPayload = { ...session, iat: now, exp: now + SESSION_TTL_MS, ep: sessionEpoch() }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `v3.${b64}.${sign(b64)}`
}

export function parseSessionToken(token: string): Session | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v3') return null
  if (!safeEqual(sign(parts[1]), parts[2])) return null
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as TokenPayload
    if (typeof p.exp !== 'number' || Date.now() > p.exp) return null
    if (p.ep !== sessionEpoch()) return null
    if (p.kind === 'manager') return { kind: 'manager', name: p.name }
    if (p.kind === 'staff') return { kind: 'staff', staffId: p.staffId, name: p.name, role: p.role }
    return null
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies()
  const token = jar.get('auth')?.value
  if (!token) return null
  return parseSessionToken(token)
}

export function isManager(s: Session | null): boolean {
  return !!s && (s.kind === 'manager' || (s.kind === 'staff' && s.role === 'Manager'))
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null
}

export async function requireAuth(): Promise<Session> {
  const session = await getSession()
  if (!session) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
  return session!
}

/** Manager-only pages: staff get sent to their board instead. */
export async function requireManager(): Promise<Session> {
  const session = await requireAuth()
  if (!isManager(session)) {
    const { redirect } = await import('next/navigation')
    redirect('/board')
  }
  return session
}
