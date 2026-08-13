import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrisma() {
  const url = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  if (!url) throw new Error('DATABASE_URL is not set')

  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({ adapter: process.env.DB_TRACE ? trace(adapter) : adapter } as any)
}

// DB_TRACE=1 prints every round trip with its duration.
//
// Wrapping the ADAPTER rather than using Prisma's `log: ['query']`: with a
// driver adapter the query event never fires, so the log option silently
// reports nothing at all — which reads as "no queries" rather than as a broken
// switch. Note what is being wrapped: `PrismaLibSql` is a FACTORY, and the
// object carrying queryRaw/executeRaw is what its `connect()` returns. Proxying
// the factory itself intercepts nothing and, again, looks like zero queries.
//
// Perceived slowness here is round trips to Turso, not CPU, so the count per
// page is the number that matters.
function trace<T extends object>(target: T): T {
  const timed = (fn: (...a: unknown[]) => Promise<unknown>, kind: string, self: unknown) =>
    async (...args: unknown[]) => {
      const t0 = Date.now()
      try { return await fn.apply(self, args) } finally {
        const sql = String((args[0] as { sql?: string })?.sql ?? '').replace(/\s+/g, ' ')
        console.log(`[q] ${String(Date.now() - t0).padStart(4)}ms ${kind} ${sql.slice(0, 110)}`)
      }
    }
  // Anything handing back another adapter-shaped object — the connection, a
  // transaction — is re-wrapped so the whole chain stays visible.
  const RETURNS_ADAPTER = new Set(['connect', 'connectToShadowDb', 'startTransaction', 'transactionContext'])
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value !== 'function') return value
      if (prop === 'queryRaw' || prop === 'executeRaw') return timed(value as never, String(prop), obj)
      if (RETURNS_ADAPTER.has(String(prop))) {
        return async (...args: unknown[]) => trace(await (value as never as (...a: unknown[]) => Promise<object>).apply(obj, args))
      }
      return (value as (...a: unknown[]) => unknown).bind(obj)
    },
  }) as T
}

// Constructed on first *use*, not on import.
//
// This used to be an eager `global.__prisma ?? (global.__prisma = createPrisma())`,
// which meant importing this module threw when DATABASE_URL was absent. Next
// imports every route while collecting page data, so the production BUILD needed
// a reachable database: a new tenant's first deploy failed before its env vars
// were set, and any deploy during a Turso blip would have failed the same way.
// A build should not need a database — only a request should.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = global.__prisma ?? (global.__prisma = createPrisma())
    const value = Reflect.get(client, prop)
    // Bind so `this` stays the real client rather than the proxy.
    return typeof value === 'function' ? value.bind(client) : value
  },
})
