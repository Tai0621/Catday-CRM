import { requireManager } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { SEGMENTS } from '@/lib/segments'
import { BrandStudio } from './BrandStudio'
import { saveBrandColours } from './actions'
import Link from 'next/link'

// C7 · Brand autopilot. Track B wired `brand.*` through the CSS variables; this
// is the generator that fills them in from the client's own logo.
export default async function BrandingPage() {
  await requireManager()
  const config = await getConfig()
  const seg = SEGMENTS.business

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Brand colours
        </h1>
        <p className="text-sm cd-muted">
          Read from the logo, checked against every place the app actually uses them, and previewed
          before anything changes. The logo itself is set in{' '}
          <Link href="/admin/settings" className="cd-link">Business Settings</Link>.
        </p>
      </div>

      {!config.brand.logoUrl ? (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            No logo is configured, so there is nothing to read colours from. Set{' '}
            <strong>Logo (light background)</strong> in{' '}
            <Link href="/admin/settings" className="cd-link">Business Settings</Link> first — or set the
            two colours there by hand.
          </p>
        </div>
      ) : (
        <BrandStudio
          logoUrl={config.brand.logoUrl}
          currentPrimary={config.brand.primary}
          currentInk={config.brand.ink}
          action={saveBrandColours}
        />
      )}
    </div>
  )
}
