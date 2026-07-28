import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-scrub'

// Browser error monitoring. No-ops unless NEXT_PUBLIC_SENTRY_DSN is set.
if (sentryOptions.enabled) {
  Sentry.init(sentryOptions)
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
