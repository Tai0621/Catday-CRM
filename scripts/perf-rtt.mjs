import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

// Is a page slow because of the DATABASE, or because of the number of TRIPS to
// it? This answers that: one query's latency, then N of them sequentially, then
// the same N fired at once through Promise.all.
//
// If "at once" lands near the single-query time, the adapter really does overlap
// them and query count barely matters. If it lands near the sequential time,
// Promise.all in a page is decorative and every query costs a full round trip —
// which makes COUNT the only lever that moves anything.

const N = 20
const db = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN }) })
const q = () => db.$queryRaw`SELECT 1`

await q() // open the connection; do not time the handshake

const t1 = Date.now(); await q(); const one = Date.now() - t1

const t2 = Date.now()
for (let i = 0; i < N; i++) await q()
const seq = Date.now() - t2

const t3 = Date.now(); await Promise.all(Array.from({ length: N }, q)); const par = Date.now() - t3

console.log(`single query          ${one}ms`)
console.log(`${N} sequential        ${seq}ms  (${Math.round(seq / N)}ms each)`)
console.log(`${N} via Promise.all   ${par}ms  (${Math.round(par / N)}ms each)`)
console.log(`\nparallelism: ${(seq / par).toFixed(1)}x — ${par > seq * 0.6 ? 'effectively SERIAL, count is the lever' : 'genuinely overlapped'}`)
await db.$disconnect()
