import { cookies } from 'next/headers'
import { createHash } from 'crypto'

export function hashPassword(password: string) {
  return createHash('sha256').update(`catday:${password}`).digest('hex')
}

export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get('auth')?.value
  if (!token) return false
  const expected = hashPassword(process.env.APP_PASSWORD ?? '')
  return token === expected
}

export async function requireAuth() {
  const ok = await isAuthenticated()
  if (!ok) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
}
