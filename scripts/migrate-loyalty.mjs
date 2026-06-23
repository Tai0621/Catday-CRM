import 'dotenv/config'

// ── Turso HTTP pipeline helper ───────────────────────────────────────────────
const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function pipeline(statements) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      requests: [...statements.map(s => ({ type: 'execute', stmt: s })), { type: 'close' }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// Run a single statement, tolerating "duplicate column"/"already exists" on re-run.
async function safe(sql, label) {
  try {
    const out = await pipeline([{ sql }])
    const r = out.results?.[0]
    if (r?.type === 'error') {
      const msg = r.error?.message ?? ''
      if (/duplicate column|already exists/i.test(msg)) {
        console.log(`  • skip (exists): ${label}`)
        return
      }
      throw new Error(msg)
    }
    console.log(`  ✓ ${label}`)
  } catch (e) {
    const msg = String(e.message ?? e)
    if (/duplicate column|already exists/i.test(msg)) {
      console.log(`  • skip (exists): ${label}`)
      return
    }
    throw e
  }
}

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null', value: null }

// ── 1. Schema changes ────────────────────────────────────────────────────────
console.log('Applying schema changes…')
const alters = [
  ['ALTER TABLE "Customer" ADD COLUMN "pointsBalance" INTEGER NOT NULL DEFAULT 0', 'Customer.pointsBalance'],
  ['ALTER TABLE "Membership" ADD COLUMN "memberNumber" INTEGER', 'Membership.memberNumber'],
  ['ALTER TABLE "MembershipTier" ADD COLUMN "tagline" TEXT', 'MembershipTier.tagline'],
  ['ALTER TABLE "MembershipTier" ADD COLUMN "qualification" TEXT NOT NULL DEFAULT \'Manual\'', 'MembershipTier.qualification'],
  ['ALTER TABLE "MembershipTier" ADD COLUMN "annualSpendThreshold" REAL', 'MembershipTier.annualSpendThreshold'],
  ['ALTER TABLE "MembershipTier" ADD COLUMN "pointsMultiplier" REAL NOT NULL DEFAULT 1', 'MembershipTier.pointsMultiplier'],
  ['ALTER TABLE "MembershipTier" ADD COLUMN "cardType" TEXT NOT NULL DEFAULT \'Digital\'', 'MembershipTier.cardType'],
]
for (const [sql, label] of alters) await safe(sql, label)

await safe(
  `CREATE TABLE IF NOT EXISTS "LoyaltyEntry" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "customerId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  'LoyaltyEntry table',
)
await safe('CREATE INDEX IF NOT EXISTS "LoyaltyEntry_customerId_idx" ON "LoyaltyEntry" ("customerId")', 'LoyaltyEntry index')

// ── 2. Seed Cat Day Prive tiers (upsert by name) ─────────────────────────────
console.log('Seeding membership tiers…')

const tiers = [
  {
    id: 'tier_essential', name: 'Essential',
    tagline: "Everyone's welcome into the Cat Day ecosystem",
    monthlyPrice: 0, annualPrice: null, groomingCredits: 0, boardingDiscount: 0,
    qualification: 'Auto', annualSpendThreshold: null, pointsMultiplier: 1, cardType: 'Digital',
    benefits: ['Birthday rewards for cats', 'Member-only pricing', 'Point collection', 'Boarding reminders', 'Access to member events'],
    color: '#729094', sortOrder: 0,
  },
  {
    id: 'tier_gold', name: 'Gold',
    tagline: 'Earned through RM3,000+ annual spend',
    monthlyPrice: 0, annualPrice: null, groomingCredits: 0, boardingDiscount: 0,
    qualification: 'Spending', annualSpendThreshold: 3000, pointsMultiplier: 1.5, cardType: 'Matte',
    benefits: ['Priority holiday boarding', 'Early booking access', 'FOC grooming add-ons', 'Free pet taxi (selected areas)', 'Emergency boarding support', 'Member-only merchandise', 'Faster point accumulation (1.5×)'],
    color: '#B8902B', sortOrder: 1,
  },
  {
    id: 'tier_black_circle', name: 'Black Circle',
    tagline: 'By invitation only — VIP clients, show cats, community leaders',
    monthlyPrice: 0, annualPrice: null, groomingCredits: 0, boardingDiscount: 0,
    qualification: 'Invitation', annualSpendThreshold: null, pointsMultiplier: 2, cardType: 'Collectible',
    benefits: ['Concierge services', 'Annual cat wellness consultation', 'Signature lounge access', 'Priority grooming appointments', 'Anniversary gift', 'Exclusive invitation-only events'],
    color: '#2D1907', sortOrder: 2,
  },
  {
    id: 'tier_wellness', name: 'Monthly Wellness Plan',
    tagline: 'RM99/month subscription',
    monthlyPrice: 99, annualPrice: null, groomingCredits: 1, boardingDiscount: 0,
    qualification: 'Paid', annualSpendThreshold: null, pointsMultiplier: 1, cardType: 'Digital',
    benefits: ['Monthly nail trimming', 'Basic spa session', 'Member perks', 'Monthly rewards'],
    color: '#B14919', sortOrder: 3,
  },
  {
    id: 'tier_vip', name: 'VIP Membership',
    tagline: 'RM399/year paid VIP membership',
    monthlyPrice: 0, annualPrice: 399, groomingCredits: 0, boardingDiscount: 0,
    qualification: 'Paid', annualSpendThreshold: null, pointsMultiplier: 1.5, cardType: 'Matte',
    benefits: ['Early booking windows', 'Concierge requests', 'Priority waitlist', 'Priority peak-season boarding', 'Exclusive rates'],
    color: '#8a6c00', sortOrder: 4,
  },
]

const upsertSql = `INSERT INTO "MembershipTier"
  ("id","name","tagline","monthlyPrice","annualPrice","groomingCredits","boardingDiscount","qualification","annualSpendThreshold","pointsMultiplier","cardType","benefits","color","sortOrder","isActive","createdAt","updatedAt")
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  ON CONFLICT("name") DO UPDATE SET
    "tagline"=excluded."tagline",
    "monthlyPrice"=excluded."monthlyPrice",
    "annualPrice"=excluded."annualPrice",
    "groomingCredits"=excluded."groomingCredits",
    "boardingDiscount"=excluded."boardingDiscount",
    "qualification"=excluded."qualification",
    "annualSpendThreshold"=excluded."annualSpendThreshold",
    "pointsMultiplier"=excluded."pointsMultiplier",
    "cardType"=excluded."cardType",
    "benefits"=excluded."benefits",
    "color"=excluded."color",
    "sortOrder"=excluded."sortOrder",
    "isActive"=1,
    "updatedAt"=CURRENT_TIMESTAMP`

const stmts = tiers.map(tier => ({
  sql: upsertSql,
  args: [
    t(tier.id), t(tier.name),
    tier.tagline ? t(tier.tagline) : nul,
    f(tier.monthlyPrice),
    tier.annualPrice == null ? nul : f(tier.annualPrice),
    i(tier.groomingCredits), f(tier.boardingDiscount),
    t(tier.qualification),
    tier.annualSpendThreshold == null ? nul : f(tier.annualSpendThreshold),
    f(tier.pointsMultiplier), t(tier.cardType),
    t(JSON.stringify(tier.benefits)),
    t(tier.color), i(tier.sortOrder),
  ],
}))

const out = await pipeline(stmts)
const errs = (out.results ?? []).filter(r => r?.type === 'error')
if (errs.length) throw new Error('Tier seed errors: ' + JSON.stringify(errs))
console.log(`  ✓ seeded ${tiers.length} tiers`)

console.log('Done.')
