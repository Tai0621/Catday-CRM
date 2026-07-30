import 'dotenv/config'
import crypto from 'node:crypto'

// Track B — baseline seed for a NEW client instance. Unlike seed-demo-data.mjs
// (Cat Day's demo customers/cats/transactions), this seeds only the neutral
// catalog scaffolding a fresh client needs to start: membership tiers, a starter
// service menu, and a couple of rooms. No customers, no brand-specific copy.
//
// Idempotent (INSERT OR IGNORE on unique names) — safe to re-run. Runs against
// whichever DB the caller points it at: PROVISION_DATABASE_URL/TOKEN if set,
// else DATABASE_URL/TOKEN. provision-client.mjs imports seedBaseline() directly.

const TIERS = [
  { name: 'Essential', tagline: 'Everyone is welcome', monthlyPrice: 0, qualification: 'Auto', pointsMultiplier: 1, cardType: 'Digital', color: '#729094', sortOrder: 0, benefits: ['Birthday rewards', 'Member pricing', 'Points collection'] },
  { name: 'Gold', tagline: 'Earned through annual spend', monthlyPrice: 0, qualification: 'Spending', annualSpendThreshold: 3000, pointsMultiplier: 1.5, cardType: 'Matte', color: '#B8902B', sortOrder: 1, benefits: ['Priority booking', 'Early access', 'Complimentary add-ons'] },
  { name: 'Black Circle', tagline: 'By invitation only', monthlyPrice: 0, qualification: 'Invitation', pointsMultiplier: 2, cardType: 'Collectible', color: '#2D1907', sortOrder: 2, benefits: ['Concierge service', 'Annual wellness consultation', 'Lounge access'] },
]

const SERVICES = [
  { name: 'Full Groom', category: 'Grooming', durationMin: 90, price: 120, sortOrder: 0 },
  { name: 'Bath & Blow-dry', category: 'Bath', durationMin: 60, price: 60, sortOrder: 1 },
  { name: 'Nail Trim', category: 'AddOn', durationMin: 15, price: 20, sortOrder: 2 },
  { name: 'Boarding (per night)', category: 'Boarding', durationMin: 60, price: 50, sortOrder: 3 },
]

const ROOMS = [
  { name: 'Room 1', type: 'Standard', capacity: 2, sortOrder: 0 },
  { name: 'Room 2', type: 'Standard', capacity: 2, sortOrder: 1 },
]

const t = v => ({ type: 'text', value: String(v) })
const iv = v => ({ type: 'integer', value: String(v) })
const fv = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null' }
const id = () => crypto.randomUUID()

function pipeFactory(url, token) {
  const HTTP = url.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
  return async function pipe(reqs) {
    const r = await fetch(HTTP, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
    })
    const j = await r.json()
    const e = j.results?.find(x => x?.type === 'error')
    if (e) throw new Error(e.error?.message)
    return j.results
  }
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

export async function seedBaseline(pipe) {
  await pipe(TIERS.map(x => exec(
    `INSERT OR IGNORE INTO MembershipTier (id,name,tagline,monthlyPrice,groomingCredits,boardingDiscount,qualification,annualSpendThreshold,pointsMultiplier,cardType,benefits,color,sortOrder,isActive,createdAt,updatedAt)
     VALUES (?,?,?,?,0,0,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(id()), t(x.name), t(x.tagline), fv(x.monthlyPrice), t(x.qualification),
      x.annualSpendThreshold ? fv(x.annualSpendThreshold) : nul, fv(x.pointsMultiplier), t(x.cardType),
      t(JSON.stringify(x.benefits)), t(x.color), iv(x.sortOrder)])))
  console.log(`  ✓ ${TIERS.length} membership tiers`)

  await pipe(SERVICES.map(x => exec(
    `INSERT OR IGNORE INTO Service (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
     VALUES (?,?,?,?,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(id()), t(x.name), t(x.category), iv(x.durationMin), fv(x.price), iv(x.sortOrder)])))
  console.log(`  ✓ ${SERVICES.length} services`)

  await pipe(ROOMS.map(x => exec(
    `INSERT OR IGNORE INTO Room (id,name,type,capacity,status,sortOrder,isActive,createdAt,updatedAt)
     VALUES (?,?,?,?,'Available',?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(id()), t(x.name), t(x.type), iv(x.capacity), iv(x.sortOrder)])))
  console.log(`  ✓ ${ROOMS.length} rooms`)
}

// CLI entry — seed against the configured (or provisioning-target) DB.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const url = process.env.PROVISION_DATABASE_URL || process.env.DATABASE_URL
  const token = process.env.PROVISION_DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN
  if (!url || !token) { console.error('Missing DB creds (PROVISION_DATABASE_URL/TOKEN or DATABASE_URL/TOKEN)'); process.exit(1) }
  console.log('Seeding baseline catalog…')
  await seedBaseline(pipeFactory(url, token))
  console.log('done')
}

export { pipeFactory }
