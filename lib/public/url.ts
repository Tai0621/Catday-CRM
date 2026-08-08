import { headers } from 'next/headers'

/**
 * The origin this deployment is being served from.
 *
 * Derived from the request rather than an env var because the same build serves
 * catday.lucidopartners.com, the .vercel.app alias and localhost, and a canonical
 * URL or sitemap that names the wrong one is worse than none — it tells search
 * engines the content lives somewhere it does not.
 */
export async function publicBaseUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
