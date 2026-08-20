import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// Lay out the boarding wall from the cabinet maker's elevations.
//
//   node scripts/seed-boarding-wall.mjs             # DRY RUN
//   node scripts/seed-boarding-wall.mjs --commit
//
// Creates the five banks and places existing rooms into them in sortOrder,
// matching 效果图.pdf: Z1 10 units (two double-height ends), Z2 9 porthole
// (3×3), Z3 18 standard (6×3), Z4 4 suites (2×2), plus a 6-cubby staging
// cabinet.
//
// It PLACES rooms that already exist rather than creating a new roster —
// deleting rooms would orphan real bookings. If there are fewer rooms than
// cells, the spare cells stay empty; if there are more, the extras stay
// unplaced and show in the wall's own Unplaced strip. Staging cubbies are the
// one thing it creates, because no equivalent room exists today.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const COMMIT = process.argv.includes('--commit')

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(v) })

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
const rows = async (sql, args = []) => (await pipe([exec(sql, args)]))[0].response.result.rows

// Zone 1 is irregular on the drawing: two double-height units at the far left
// and far right with eight singles filling the middle in a 3 / 2 / 3 stack.
// Column 4 of row 2 is genuinely empty — that gap is in the elevation.
const Z1_CELLS = [
  [1, 1, 1, 2], [2, 1, 1, 1], [3, 1, 1, 1], [4, 1, 2, 1],
  [2, 2, 1, 1], [3, 2, 1, 1], [5, 2, 1, 2],
  [1, 3, 1, 1], [2, 3, 1, 1], [3, 3, 2, 1],
]
const grid = (cols, rowCount) => {
  const out = []
  for (let r = 1; r <= rowCount; r++) for (let c = 1; c <= cols; c++) out.push([c, r, 1, 1])
  return out
}

const ZONES = [
  { code: 'Z1', name: 'Feature wall', kind: 'Boarding', cols: 5, rows: 3, unitKind: 'arch', cells: Z1_CELLS },
  { code: 'Z2', name: 'Porthole bank', kind: 'Boarding', cols: 3, rows: 3, unitKind: 'porthole', cells: grid(3, 3) },
  { code: 'Z3', name: 'Standard bank', kind: 'Boarding', cols: 6, rows: 3, unitKind: 'arch', cells: grid(6, 3) },
  { code: 'Z4', name: 'Suites', kind: 'Boarding', cols: 2, rows: 2, unitKind: 'suite', cells: grid(2, 2) },
  { code: 'S', name: 'Staging cabinet', kind: 'Staging', cols: 3, rows: 2, unitKind: 'cubby', cells: grid(3, 2) },
]

const existing = await rows(`SELECT id, name, type, sortOrder, zoneId FROM Room WHERE isActive = 1 ORDER BY sortOrder`)
const roomList = existing.map(r => ({
  id: r[0].value, name: r[1].value, type: r[2].value,
  sortOrder: Number(r[3].value), zoneId: r[4]?.value ?? null,
}))

// Suites go in the suite bank; everything else fills the boarding banks in
// order. Matching by `type` keeps the roster's own meaning rather than
// scattering a Suite into a standard cell.
const suites = roomList.filter(r => r.type === 'Suite')
const standard = roomList.filter(r => r.type !== 'Suite')

const boardingZones = ZONES.filter(z => z.kind === 'Boarding')
const plan = []
let cursor = 0
let suiteCursor = 0
for (const z of boardingZones) {
  for (const [col, row, cs, rs] of z.cells) {
    const pool = z.code === 'Z4' ? suites : standard
    const idx = z.code === 'Z4' ? suiteCursor++ : cursor++
    const room = pool[idx]
    if (!room) continue
    plan.push({ room, zone: z, col, row, colSpan: cs, rowSpan: rs })
  }
}

const staging = ZONES.find(z => z.kind === 'Staging')
const stagingNames = staging.cells.map((_, n) => `Staging ${n + 1}`)
const haveStaging = new Set(roomList.filter(r => stagingNames.includes(r.name)).map(r => r.name))
const stagingToCreate = stagingNames.filter(n => !haveStaging.has(n))

const placedIds = new Set(plan.map(p => p.room.id))
const leftOver = roomList.filter(r => !placedIds.has(r.id) && !stagingNames.includes(r.name))

console.log(`\nRooms active: ${roomList.length}  (${standard.length} standard, ${suites.length} suite)`)
console.log('Banks:')
for (const z of ZONES) {
  const n = plan.filter(p => p.zone.code === z.code).length
  const cells = z.cells.length
  console.log(`  ${z.code.padEnd(3)} ${z.name.padEnd(17)} ${z.cols}×${z.rows} · ${cells} cells · ${z.kind === 'Staging' ? `${stagingNames.length} cubbies` : `${n} placed`}`)
}
console.log(`\nTo place: ${plan.length}`)
console.log(`Staging cubbies to create: ${stagingToCreate.length}`)
console.log(`Left unplaced (shown in the wall's Unplaced strip): ${leftOver.length}`)
if (leftOver.length) console.log(`  ${leftOver.slice(0, 12).map(r => r.name).join(', ')}${leftOver.length > 12 ? ' …' : ''}`)

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.')
  process.exit(0)
}

// ── banks ──
const zoneIds = {}
for (const [n, z] of ZONES.entries()) {
  const found = await rows(`SELECT id FROM RoomZone WHERE code = ?`, [t(z.code)])
  if (found.length) {
    zoneIds[z.code] = found[0][0].value
    await pipe([exec(
      `UPDATE RoomZone SET name = ?, kind = ?, cols = ?, rows = ?, sortOrder = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [t(z.name), t(z.kind), i(z.cols), i(z.rows), i(n), t(zoneIds[z.code])])])
  } else {
    const id = crypto.randomUUID()
    zoneIds[z.code] = id
    await pipe([exec(
      `INSERT INTO RoomZone (id, code, name, kind, cols, rows, sortOrder, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(id), t(z.code), t(z.name), t(z.kind), i(z.cols), i(z.rows), i(n)])])
  }
}
console.log(`\n✓ ${ZONES.length} banks`)

// ── staging cubbies ──
let maxSort = roomList.reduce((m, r) => Math.max(m, r.sortOrder), 0)
for (const name of stagingToCreate) {
  await pipe([exec(
    `INSERT INTO Room (id, name, type, capacity, status, sortOrder, isActive, unitKind, colSpan, rowSpan, createdAt, updatedAt)
     VALUES (?,?,?,1,'Available',?,1,'cubby',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(name), t('DayStay'), i(++maxSort)])])
}
if (stagingToCreate.length) console.log(`✓ ${stagingToCreate.length} staging cubbies created`)

const stagingRooms = await rows(
  `SELECT id, name FROM Room WHERE name IN (${stagingNames.map(() => '?').join(',')})`,
  stagingNames.map(t))
stagingRooms.sort((a, b) => a[1].value.localeCompare(b[1].value, undefined, { numeric: true }))
stagingRooms.forEach((r, n) => {
  const [col, row] = staging.cells[n] ?? []
  if (col) plan.push({ room: { id: r[0].value, name: r[1].value }, zone: staging, col, row, colSpan: 1, rowSpan: 1 })
})

// ── placement ──
for (const p of plan) {
  await pipe([exec(
    `UPDATE Room SET zoneId = ?, gridCol = ?, gridRow = ?, colSpan = ?, rowSpan = ?, unitKind = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [t(zoneIds[p.zone.code]), i(p.col), i(p.row), i(p.colSpan), i(p.rowSpan), t(p.zone.unitKind), t(p.room.id)])])
}
console.log(`✓ ${plan.length} rooms placed`)
console.log('\nOpen /rooms to see the wall. Anything unplaced is in its own strip — check it against')
console.log('the real cabinets before trusting the picture; every tile carries its room number.')
