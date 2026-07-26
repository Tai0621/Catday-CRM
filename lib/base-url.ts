import { headers } from 'next/headers'

// Absolute origin for links that leave the app (e.g. a receipt link sent over
// WhatsApp). Derived from the request headers so it's correct on Vercel, on the
// preview URL, and locally without needing an env var.
export async function absoluteUrl(path = ''): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}${path}`
}
