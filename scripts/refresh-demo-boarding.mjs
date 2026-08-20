import 'dotenv/config'
import './_guard.mjs'

// Bring the demo's boarding data back to today.
//
//   node scripts/refresh-demo-boarding.mjs            # DRY RUN
//   node scripts/refresh-demo-boarding.mjs --commit
//
// The demo carries stays that are still `CheckedIn` but whose window closed
// days ago — a cat checked in and never checked out. Every boarding screen reads
// "is this stay's window over today", so the run sheet, the room calendar and
// the Boarding Wall all go blank as the seed date recedes, and the demo looks
// broken rather than quiet.
//
// This shifts each stranded stay forward by whole days so it spans today,
// keeping its own length and its room. It creates nothing and deletes nothing:
// the same cats are in the same rooms for the same number of nights.
//
// Guarded like every script here — it refuses to touch the live database.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const COMMIT = process.argv.includes('--commit')

const t = v => ({ type: 'text', value: String(v) })

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

const DAY = 24 * 60 * 60 * 1000
const now = new Date()

const res = await pipe([exec(
  `SELECT a.id, a.scheduledAt, a.endsAt, c.name, r.name
   FROM Appointment a
   JOIN Cat c ON c.id = a.catId
   LEFT JOIN Room r ON r.id = a.roomId
   WHERE a.type = 'Boarding' AND a.status = 'CheckedIn' AND a.endsAt IS NOT NULL
   ORDER BY a.scheduledAt`)])
const stays = res[0].response.result.rows.map(r => ({
  id: r[0].value,
  start: new Date(r[1].value),
  end: new Date(r[2].value),
  cat: r[3]?.value ?? '—',
  room: r[4]?.value ?? 'no room',
}))

// Only the ones whose window has already closed. A stay that legitimately spans
// today is left exactly as it is.
const stranded = stays.filter(s => s.end < now)

console.log(`\nChecked-in boarding stays: ${stays.length}`)
console.log(`Spanning today already:    ${stays.length - stranded.length}`)
console.log(`Stranded in the past:      ${stranded.length}\n`)

const plan = stranded.map((s, i) => {
  const nights = Math.max(1, Math.round((s.end.getTime() - s.start.getTime()) / DAY))
  // Fan the check-outs across the next few days so the wall shows a mix of
  // "leaving today" and "staying on" rather than every cat leaving at once.
  const leavesIn = i % 4
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + leavesIn, 12, 0, 0)
  const start = new Date(end.getTime() - nights * DAY)
  return { ...s, nights, start, end }
})

for (const p of plan) {
  const d = n => n.toISOString().slice(0, 10)
  console.log(`  ${p.cat.padEnd(14)} ${p.room.padEnd(10)} ${d(p.start)} → ${d(p.end)}  (${p.nights}n, was ${d(p.end === p.end ? stranded.find(s => s.id === p.id).end : p.end)})`)
}

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.')
  process.exit(0)
}

for (const p of plan) {
  await pipe([exec(
    `UPDATE Appointment SET scheduledAt = ?, endsAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [t(p.start.toISOString()), t(p.end.toISOString()), t(p.id)])])
}

// Room.status is a standing flag the wall does not trust — occupancy comes from
// the day's stays — but the list view still reads it, so keep the two agreeing.
await pipe([
  exec(`UPDATE Room SET status = 'Available' WHERE status = 'Occupied'`),
  exec(`UPDATE Room SET status = 'Occupied' WHERE id IN (
          SELECT roomId FROM Appointment
          WHERE type IN ('Boarding','Residency') AND status = 'CheckedIn' AND roomId IS NOT NULL)`),
])

console.log(`\n✓ ${plan.length} stays moved to span today`)
console.log('✓ room statuses re-synced with who is actually in')
console.log('\nThe wall, the run sheet and the room calendar all read from the same stays.')
