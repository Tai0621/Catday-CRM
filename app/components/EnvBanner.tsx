import { appEnv, ENV_BADGE } from '@/lib/environment'
import { OS_VERSION } from '@/lib/version'

/**
 * A standing marker on every non-production deployment.
 *
 * The demo and the live OS render the same screens from the same code, so
 * without this there is nothing on screen to tell them apart — and someone
 * eventually acts on demo numbers believing they are the business's own, or
 * reports a "bug" that is really unreleased work. Renders nothing in
 * production.
 */
export function EnvBanner() {
  const env = appEnv()
  if (env === 'production') return null
  const badge = ENV_BADGE[env]

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1 text-xs shrink-0"
      style={{ background: badge.background, color: badge.color }}>
      <span className="font-bold tracking-wider">{badge.label}</span>
      <span style={{ opacity: 0.85 }}>{badge.note}</span>
      <span style={{ opacity: 0.6 }}>v{OS_VERSION}</span>
    </div>
  )
}
