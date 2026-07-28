import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-scrub'

// Server + edge error monitoring. No-ops entirely unless NEXT_PUBLIC_SENTRY_DSN
// is set (see sentryOptions.enabled), so it's safe to ship before Sentry is
// wired up.
export async function register() {
  if (!sentryOptions.enabled) return
  Sentry.init(sentryOptions)
}

export const onRequestError = Sentry.captureRequestError
