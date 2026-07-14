import { cookies } from 'next/headers'
import { createHash } from 'crypto'

// ── Sessions ─────────────────────────────────────────────────────────────────
// Two kinds of login share one cookie:
//   manager  — the owner password (APP_PASSWORD)
//   staff    — a personal PIN from the Staff table; role decides what they see
// Token format: "v2.<base64url payload>.<sha256 signature>"; the pre-staff
// legacy cookie (plain password hash) is still accepted as a manager session.

export type Session =
  | { kind: 'manager'; name: string }
  | { kind: 'staff'; staffId: string; name: string; role: string }

export function hashPassword(password: string) {
  return createHash('sha256').update(`catday:${password}`).digest('hex')
}

function secret() {
  return process.env.APP_PASSWORD ?? ''
}

function sign(payloadB64: string) {
  return createHash('sha256').update(`catday-session:${payloadB64}:${secret()}`).digest('hex')
}

export function makeSessionToken(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return `v2.${payload}.${sign(payload)}`
}

export function parseSessionToken(token: string): Session | null {
  if (token === hashPassword(secret())) return { kind: 'manager', name: 'Owner' } // legacy cookie
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v2') return null
  if (sign(parts[1]) !== parts[2]) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Session
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
