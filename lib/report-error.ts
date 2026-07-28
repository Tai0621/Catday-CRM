// Client-safe error reporter used by the error boundaries. Logs, and hands off
// to Sentry when it's configured (Sentry.init in instrumentation-client.ts gates
// on the DSN, so captureException is a harmless no-op otherwise). Never throws.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    console.error('[app error]', error, context ?? '')
    import('@sentry/nextjs')
      .then(Sentry => { Sentry.captureException(error, { extra: context }) })
      .catch(() => {})
  } catch {
    // reporting must not itself break the error screen
  }
}
