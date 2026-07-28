import type { ErrorEvent } from '@sentry/nextjs'

// Strip personal data before anything leaves for Sentry. We keep sendDefaultPii
// off, drop request cookies/headers (they carry the auth token), and redact
// phone-number-shaped strings from messages and breadcrumbs.
const PHONE_RE = /(\+?60|\b0)\d[\d\s-]{6,}\d/g
const redact = (s: string) => s.replace(PHONE_RE, '[redacted]')

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
  }
  if (event.message) event.message = redact(event.message)
  event.exception?.values?.forEach(v => { if (v.value) v.value = redact(v.value) })
  event.breadcrumbs?.forEach(b => { if (b.message) b.message = redact(b.message) })
  return event
}

// Common init options; the DSN gates whether Sentry does anything at all.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
}
