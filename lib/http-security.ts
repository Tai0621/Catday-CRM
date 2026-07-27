import { timingSafeEqual } from 'crypto'

// Constant-time string compare for secrets/signatures — avoids leaking how many
// leading characters matched via response timing. Length mismatch short-circuits
// (the lengths themselves aren't secret).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
