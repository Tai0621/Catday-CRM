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
  return new PrismaClient({ adapter } as any)
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
