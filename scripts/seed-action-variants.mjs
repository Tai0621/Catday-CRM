import 'dotenv/config'

// C4 · Starting copy for the three testable nudges.
// Two arms each, deliberately differing on ONE axis so the result is readable:
// what actually changed when the number moves. Written to the brand voice
// profile (M8) — warm, unhurried, one 🐾 at most, offers rather than demands.
//
// Idempotent: re-running updates the body of an existing (type,label) rather
// than creating duplicates, so editing this file and re-running is safe.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const t = v => ({ type: 'text', value: String(v) })

const VARIANTS = [
  // Axis under test: does naming a concrete incentive beat a warm, no-strings hello?
  ['WinBack', 'Warm', `Hi! It's been a while — {cat} misses us at {brand} 🐾 Whenever you're ready, we'd love to have {cat} back in.`],
  ['WinBack', 'Offer-led', `Hi! It's been a while since we saw {cat} at {brand} 🐾 Book this week and we'll add a complimentary add-on for {cat}.`],

  // Axis under test: asking now, versus leaving the door open.
  ['RebookCheckout', 'Book now', `Hi! {cat} checks out today — shall we lock in the next grooming or boarding date before you head off? 🐾`],
  ['RebookCheckout', 'Open door', `Hi! {cat} checks out today and has been lovely to have 🐾 Just say the word whenever you'd like the next stay booked.`],

  // Axis under test: does saying how overdue they are help, or does it nag?
  ['GroomingDue', 'Simple', `Hi! {cat} is due for a groom — shall we find a slot this week? 🐾`],
  ['GroomingDue', 'With timing', `Hi! It's been about {days} days since {cat}'s last groom 🐾 Shall we find a slot this week?`],
]

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}

console.log('C4 · seeding message variants')
await pipe(VARIANTS.map(([type, label, body]) => ({
  type: 'execute',
  stmt: {
    sql: `INSERT INTO ActionVariant (id,type,label,body,isActive,isDefault,createdAt,updatedAt)
          VALUES (?,?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(type,label) DO UPDATE SET body = excluded.body, updatedAt = CURRENT_TIMESTAMP`,
    args: [t(crypto.randomUUID()), t(type), t(label), t(body)],
  },
})))

for (const [type, label] of VARIANTS) console.log(`  ✓ ${type} · ${label}`)
console.log(`done — ${VARIANTS.length} variants across 3 types`)
