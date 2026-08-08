import type { MetadataRoute } from 'next'
import { getConfig } from '@/lib/config'
import { isProduction } from '@/lib/environment'
import { publicBaseUrl } from '@/lib/public/url'

// M6 · Only genuinely public, indexable pages belong here.
//
// Empty unless the tenant published their page AND this is production. The demo
// runs a real-looking business on a public URL; a sitemap would invite Google
// to index it alongside the client it imitates.
// Must be rendered per request. Prerendered at build time it would freeze the
// tenant's publish setting into the deployment, so turning the page off in
// Settings would leave a sitemap still advertising it until the next deploy.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await getConfig()
  if (!config.publicPage.enabled || !isProduction()) return []

  const base = await publicBaseUrl()
  return [
    { url: `${base}/visit`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/careers`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
