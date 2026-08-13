import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

// Promise.all does not overlap queries on this adapter (see perf-rtt.mjs), so
// the question becomes: is there ANY way to spend fewer round trips for the
// same N reads? Three candidates, measured rather than assumed.

const N = 20
const db = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN }) })
const time = async (label, fn) => {
  await fn() // warm
  const t = Date.now(); await fn(); console.log(`${label.padEnd(34)} ${String(Date.now() - t).padStart(6)}ms`)
}

const reads = () => Array.from({ length: N }, () => db.customer.count())

await time('sequential await', async () => { for (let i = 0; i < N; i++) await db.customer.count() })
await time('Promise.all', async () => { await Promise.all(reads()) })
await time('$transaction([...]) batch', async () => { await db.$transaction(reads()) })

// The raw pipeline: every migration and verify script in this repo already
// speaks it. One HTTP request, many statements, one round trip.
const HTTP = process.env.DATABASE_URL.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
await time('raw /v2/pipeline (one request)', async () => {
  await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DATABASE_AUTH_TOKEN}` },
    body: JSON.stringify({
      requests: [
        ...Array.from({ length: N }, () => ({ type: 'execute', stmt: { sql: 'SELECT COUNT(*) FROM Customer' } })),
        { type: 'close' },
      ],
    }),
  }).then(r => r.json())
})

await db.$disconnect()
