// Client-safe error reporter used by the error boundaries. Today it just logs;
// Phase 3 commit 3 wires Sentry capture in here, so the boundaries never change.
// Must never throw.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    console.error('[app error]', error, context ?? '')
  } catch {
    // reporting must not itself break the error screen
  }
}
