// Login rate-limiting. We count FAILED attempts per IP inside a rolling window
// and block once they cross a threshold; a successful login clears the counter,
// so ordinary use never trips it — only sustained guessing does.
//
// Storage: Upstash Redis when configured (durable across the serverless fleet),
// otherwise a per-process in-memory window. In-memory is weaker on a multi-
// instance deploy, but it keeps the feature working (and locally testable)
// before Upstash is wired up, and never blocks a legitimate login.

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS = 8

const mem = new Map<string, number[]>()
function memRecent(key: string): number[] {
  const now = Date.now()
  const arr = (mem.get(key) ?? []).filter(ts => now - ts < WINDOW_MS)
  mem.set(key, arr)
  return arr
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisPromise: Promise<any> | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRedis(): Promise<any> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  if (redisPromise === undefined) {
    redisPromise = import('@upstash/redis')
      .then(({ Redis }) => new Redis({ url, token }))
      .catch(() => null)
  }
  return redisPromise
}

const rkey = (k: string) => `loginfail:${k}`

export async function isLoginBlocked(key: string): Promise<boolean> {
  const redis = await getRedis()
  if (redis) {
    const now = Date.now()
    const raw: unknown[] = await redis.lrange(rkey(key), 0, -1)
    const recent = raw.map(Number).filter(ts => now - ts < WINDOW_MS)
    return recent.length >= MAX_FAILS
  }
  return memRecent(key).length >= MAX_FAILS
}

export async function recordLoginFailure(key: string): Promise<void> {
  const redis = await getRedis()
  if (redis) {
    await redis.rpush(rkey(key), Date.now())
    await redis.pexpire(rkey(key), WINDOW_MS)
    return
  }
  const arr = memRecent(key)
  arr.push(Date.now())
  mem.set(key, arr)
}

export async function clearLoginFailures(key: string): Promise<void> {
  const redis = await getRedis()
  if (redis) {
    await redis.del(rkey(key))
    return
  }
  mem.delete(key)
}

export const LOGIN_RETRY_AFTER_MINUTES = Math.ceil(WINDOW_MS / 60000)
