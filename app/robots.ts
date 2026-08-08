import type { MetadataRoute } from 'next'
import { getConfig } from '@/lib/config'
import { isProduction } from '@/lib/environment'
import { publicBaseUrl } from '@/lib/public/url'

// M6 · The OS is a private business system with three public pages. The default
// posture is therefore DISALLOW EVERYTHING, and the public pages are allowed
// back in one at a time — the opposite of the usual "allow all, block a few",
// because getting that wrong here exposes a customer list rather than a blog.
//
// A non-production deployment, or a tenant who has not published, disallows
// everything outright.
// Per request, for the same reason as the sitemap: a build-time snapshot would
// keep saying "crawl me" after the tenant unpublished.
export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await getConfig()
  const open = config.publicPage.enabled && isProduction()
  if (!open) return { rules: [{ userAgent: '*', disallow: '/' }] }

  const base = await publicBaseUrl()
  return {
    rules: [{ userAgent: '*', allow: ['/visit', '/careers', '/privacy'], disallow: '/' }],
    sitemap: `${base}/sitemap.xml`,
  }
}
