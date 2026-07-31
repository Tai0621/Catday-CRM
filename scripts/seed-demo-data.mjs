import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createHash, randomUUID } from 'node:crypto'

// Rich, realistic demo data for the LOCAL demo database only (prisma/demo.db).
// Never touches the shared Turso database that dev/production point at.
// Run scripts/setup-local-demo.mjs first to create the empty schema, then this.

const adapter = new PrismaLibSql({ url: 'file:./prisma/demo.db' })
const db = new PrismaClient({ adapter })

const hashPin = pin => createHash('sha256').update(`catday:${pin}`).digest('hex')
const r2 = v => Math.round(v * 100) / 100
const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n)
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const now = new Date()
const atHour = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0)
const daysAgo = n => new Date(now.getTime() - n * 86400000)
const daysFromNow = n => new Date(now.getTime() + n * 86400000)
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

console.log('Seeding demo data into prisma/demo.db …\n')

// ── 1. Membership tiers (the real Cat Day Prive structure) ──────────────────
console.log('· Membership tiers')
const tierDefs = [
  { name: 'Essential', tagline: "Everyone's welcome into the Cat Day ecosystem", monthlyPrice: 0, groomingCredits: 0, boardingDiscount: 0, qualification: 'Auto', pointsMultiplier: 1, cardType: 'Digital', color: '#729094', sortOrder: 0, benefits: ['Birthday rewards for cats', 'Member-only pricing', 'Point collection'] },
  { name: 'Gold', tagline: 'Earned through RM3,000+ annual spend', monthlyPrice: 0, groomingCredits: 0, boardingDiscount: 0, qualification: 'Spending', annualSpendThreshold: 3000, pointsMultiplier: 1.5, cardType: 'Matte', color: '#B8902B', sortOrder: 1, benefits: ['Priority holiday boarding', 'Early booking access', 'FOC grooming add-ons'] },
  { name: 'Black Circle', tagline: 'By invitation only — VIP clients, show cats, community leaders', monthlyPrice: 0, groomingCredits: 0, boardingDiscount: 0, qualification: 'Invitation', pointsMultiplier: 2, cardType: 'Collectible', color: '#2D1907', sortOrder: 2, benefits: ['Concierge services', 'Annual wellness consultation', 'Signature lounge access'] },
  { name: 'Monthly Wellness Plan', tagline: 'RM99/month subscription', monthlyPrice: 99, groomingCredits: 1, boardingDiscount: 0, qualification: 'Paid', pointsMultiplier: 1, cardType: 'Digital', color: '#B14919', sortOrder: 3, benefits: ['Monthly nail trimming', 'Basic spa session'] },
]
const tiers = {}
for (const t of tierDefs) {
  tiers[t.name] = await db.membershipTier.create({ data: { ...t, benefits: JSON.stringify(t.benefits) } })
}

// ── 2. Staff ──────────────────────────────────────────────────────────────
console.log('· Staff (PINs printed at the end)')
const staffDefs = [
  { name: 'Amy Tan', role: 'Manager', pin: '1010' },
  { name: 'Wei Xin', role: 'Groomer', pin: '2020' },
  { name: 'Faris Iskandar', role: 'Groomer', pin: '2021' },
  { name: 'Siti Aminah', role: 'Boarding', pin: '3030' },
  { name: 'Nurul Izzati', role: 'FrontDesk', pin: '4040' },
]
const staff = {}
for (const s of staffDefs) {
  staff[s.name] = await db.staff.create({ data: { name: s.name, role: s.role, pinHash: hashPin(s.pin) } })
}
const groomers = [staff['Wei Xin'], staff['Faris Iskandar']]

// ── 3. Service menu (the real menu) ──────────────────────────────────────
console.log('· Service menu')
const serviceDefs = [
  ['Full Groom', 'Grooming', 90, 180],
  ['Basic Bath & Dry', 'Bath', 60, 120],
  ['De-matting Session', 'Grooming', 120, 250],
  ['Seasonal Care Package', 'Grooming', 90, 128],
  ['Health Diagnosis & Profiling', 'Diagnosis', 30, 88],
  ['Stress & Behaviour Assessment', 'Diagnosis', 30, 68],
  ['Boarding — Standard (per night)', 'Boarding', 0, 80],
  ['Boarding — Suite (per night)', 'Boarding', 0, 120],
]
const services = {}
for (const [name, category, durationMin, price] of serviceDefs) {
  services[name] = await db.service.create({ data: { name, category, durationMin, price, sortOrder: Object.keys(services).length } })
}
const groomingServices = [services['Full Groom'], services['Basic Bath & Dry'], services['De-matting Session'], services['Seasonal Care Package']]
const boardStd = services['Boarding — Standard (per night)']
const boardSuite = services['Boarding — Suite (per night)']

// ── 4. Rooms — matches the real business layout (54 Standard + 7 Suite) ────
console.log('· Rooms (54 Standard + 7 Suite)')
await db.room.createMany({
  data: [
    ...Array.from({ length: 54 }, (_, i) => ({ name: `Room ${String(i + 1).padStart(2, '0')}`, type: 'Standard', sortOrder: i })),
    ...Array.from({ length: 7 }, (_, i) => ({ name: `Suite ${i + 1}`, type: 'Suite', sortOrder: 54 + i })),
  ],
})
const stdRooms = await db.room.findMany({ where: { type: 'Standard' }, orderBy: { sortOrder: 'asc' } })
const suiteRooms = await db.room.findMany({ where: { type: 'Suite' }, orderBy: { sortOrder: 'asc' } })

// ── 5. Retail products ───────────────────────────────────────────────────
console.log('· Retail products')
// Starting stock is generous enough to survive 7 months of simulated sell-through
// without running out (the sale loop below never oversells); two SKUs are forced
// down to a low-stock demo state in a final pass after everything else settles.
const productDefs = [
  ['OKANA Gift Box', 88, 50, 120],
  ['Premium Cat Shampoo 250ml', 45, 22, 150],
  ['Grooming Brush Deluxe', 35, 15, 90],
  ['Catnip Toy Set', 18, 7, 200],
  ['Freeze-Dried Treats 50g', 28, 14, 260],
  ['Cat Nail Clipper', 25, 10, 110],
  ['Anti-Hairball Paste', 32, 16, 140],
  ['Premium Cat Litter 5kg', 55, 32, 100],
  ['Ear Cleaning Solution', 22, 9, 130],
  ['Interactive Feather Wand', 20, 8, 170],
]
const products = {}
for (const [name, price, costPrice, stockQty] of productDefs) {
  products[name] = await db.product.create({ data: { name, price, costPrice, stockQty, sortOrder: Object.keys(products).length } })
}
const productList = Object.values(products)

// ── 6. Customers + cats ──────────────────────────────────────────────────
console.log('· Customers & cats')
const customerNames = [
  'Tan Wei Ling', 'Nurul Aina', 'Priya Devi Ramasamy', 'Lim Jia Hui', 'Ahmad Faiz Zulkifli',
  'Chong Mei Yee', 'Siti Nurhaliza Hassan', 'Kavitha Sundaram', 'Wong Kar Mun', 'Muhammad Hafiz Ismail',
  'Ong Li Xuan', 'Rajesh Kumar', 'Lee Zhi Wei', 'Farah Aleesya Rosli', 'Chan Yoke Ling',
  'Balqis Iman', 'Teoh Boon Keat', 'Aravind Menon', 'Ng Sze Ying', 'Aisyah Humaira',
]
const catNames = ['Mochi', 'Miso', 'Luna', 'Oreo', 'Biscuit', 'Tofu', 'Milo', 'Coco', 'Nala', 'Simba', 'Ginger', 'Peanut', 'Waffles', 'Choco', 'Sushi', 'Mango', 'Kiwi', 'Pudding', 'Bubu', 'Momo', 'Snowy', 'Shadow', 'Whiskers', 'Duke', 'Bella', 'Leo']
const breeds = ['Persian', 'Maine Coon', 'Ragdoll', 'British Shorthair', 'Scottish Fold', 'Siamese', 'Domestic Shorthair', 'Sphynx', 'Siberian', 'Bengal']
let catNameIdx = 0

const customers = []
for (let i = 0; i < customerNames.length; i++) {
  const name = customerNames[i]
  const phone = `+601${randInt(10000000, 99999999)}`
  // Spread signup dates over the last 8 months so segments (New/Regular/VIP/Lost) vary naturally
  const createdAt = daysAgo(randInt(5, 240))
  const source = pick(['WalkIn', 'GoogleForm', 'WhatsApp', 'Referral', 'WalkIn'])
  const consent = Math.random() > 0.3
  const consentSource = source === 'GoogleForm' ? 'GoogleForm' : source === 'WhatsApp' ? 'WhatsApp' : 'Staff'
  const c = await db.customer.create({
    data: {
      name, phone, createdAt, updatedAt: createdAt,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      source,
      marketingConsent: consent,
      marketingConsentAt: consent ? createdAt : null,
      marketingConsentSource: consent ? consentSource : null,
    },
  })
  const catCount = Math.random() > 0.75 ? 2 : 1
  const cats = []
  for (let k = 0; k < catCount; k++) {
    const coatType = Math.random() > 0.5 ? 'Long' : 'Short'
    const cat = await db.cat.create({
      data: {
        name: catNames[catNameIdx++ % catNames.length],
        customerId: c.id,
        breed: pick(breeds),
        gender: pick(['Male', 'Female']),
        lifeStage: pick(['Kitten', 'Adult', 'Adult', 'Adult', 'Senior']),
        coatType,
        dateOfBirth: daysAgo(randInt(365, 365 * 8)),
        vaccinationExpiry: daysFromNow(randInt(-10, 200)),
      },
    })
    cats.push(cat)
  }
  customers.push({ ...c, cats })
}

// Founding Cats (first 6) — permanent numbered circle
for (let i = 0; i < 6; i++) {
  await db.cat.update({ where: { id: customers[i].cats[0].id }, data: { foundingNumber: i + 1 } })
}

// ── 7. Memberships — a mix of tiers so the CRM segments look real ──────────
console.log('· Memberships')
const goldCustomers = customers.slice(0, 4)
const blackCircleCustomers = customers.slice(4, 6)
const wellnessCustomers = customers.slice(6, 8)
let memberNo = 1
for (const c of goldCustomers) {
  await db.membership.create({ data: { customerId: c.id, tierId: tiers['Gold'].id, memberNumber: memberNo++, startDate: daysAgo(120), expiryDate: daysFromNow(randInt(10, 300)), status: 'Active' } })
}
for (const c of blackCircleCustomers) {
  await db.membership.create({ data: { customerId: c.id, tierId: tiers['Black Circle'].id, memberNumber: memberNo++, startDate: daysAgo(200), expiryDate: daysFromNow(randInt(10, 300)), status: 'Active' } })
}
for (const c of wellnessCustomers) {
  await db.membership.create({ data: { customerId: c.id, tierId: tiers['Monthly Wellness Plan'].id, memberNumber: memberNo++, startDate: daysAgo(60), expiryDate: daysFromNow(30), status: 'Active' } })
}
// One membership expiring very soon (Action Inbox demo)
await db.membership.create({ data: { customerId: customers[8].id, tierId: tiers['Gold'].id, memberNumber: memberNo++, startDate: daysAgo(350), expiryDate: daysFromNow(5), status: 'Active' } })

function tierMultiplierFor(customerId) {
  if (blackCircleCustomers.some(c => c.id === customerId)) return 2
  if (goldCustomers.some(c => c.id === customerId)) return 1.5
  return 1
}

// ── 8. Wallet top-ups for a few customers ───────────────────────────────
console.log('· Wallet top-ups')
const walletCustomers = pickN(customers, 5)
// Live running balance, depleted as sales spend from it below — the final
// value here (not an increment) is written to Customer.walletBalance at the end.
const liveWalletBalance = new Map()
for (const c of walletCustomers) {
  const pkg = pick([{ pay: 500, bonus: 50 }, { pay: 1000, bonus: 150 }])
  await db.walletEntry.create({ data: { customerId: c.id, amount: pkg.pay, kind: 'TopUp', note: 'Opening offer top-up', createdAt: daysAgo(randInt(20, 90)) } })
  await db.walletEntry.create({ data: { customerId: c.id, amount: pkg.bonus, kind: 'Bonus', note: 'Top-up bonus', createdAt: daysAgo(randInt(20, 90)) } })
  liveWalletBalance.set(c.id, pkg.pay + pkg.bonus)
}

// ── 9. Revenue history — 6 full months + current partial month ─────────────
console.log('· Revenue history (appointments, POS sales, retail, membership, academy)')
const REVENUE_CATEGORY_WEIGHTS = { Grooming: 0.40, Boarding: 0.32, Retail: 0.09, Membership: 0.10, Academy: 0.05, Other: 0.04 }
const monthTargets = [26000, 32000, 39000, 47000, 56000, 64000] // months -6..-1
const monthlyRevenueActual = new Map() // month key -> actual generated revenue, for consistent COGS/plan-target scaling below
const pointsBalanceDelta = new Map()

function addPoints(customerId, points) {
  pointsBalanceDelta.set(customerId, (pointsBalanceDelta.get(customerId) ?? 0) + points)
}

async function sellGroomingOrBoarding({ type, date, customer, cat, useWallet }) {
  const isBoarding = type === 'Boarding'
  const service = isBoarding ? pick([boardStd, boardSuite]) : pick(groomingServices)
  const nights = isBoarding ? randInt(1, 4) : 1
  const price = r2(service.price * nights)
  const staffMember = isBoarding ? staff['Siti Aminah'] : pick(groomers)
  const room = isBoarding ? pick(service.id === boardSuite.id ? suiteRooms : stdRooms) : null

  const appt = await db.appointment.create({
    data: {
      customerId: customer.id, catId: cat.id, type,
      serviceId: service.id, staffId: staffMember.id,
      scheduledAt: date, endsAt: isBoarding ? new Date(date.getTime() + nights * 86400000) : new Date(date.getTime() + service.durationMin * 60000),
      status: 'Completed', price, paid: true, roomId: room?.id ?? null,
      createdAt: date, updatedAt: date,
    },
  })

  const reference = `CD-${randomUUID().slice(0, 8).toUpperCase()}`
  // Cap the wallet contribution at half the price so cashPortion is always > 0 —
  // sidesteps the fully-wallet-paid edge case (a different accounting branch in
  // the real checkout()) which this demo helper doesn't need to replicate.
  const available = useWallet ? (liveWalletBalance.get(customer.id) ?? 0) : 0
  const walletPortion = available > 0 ? r2(Math.min(available, price * 0.5)) : 0
  const cashPortion = r2(price - walletPortion)
  const method = pick(['Cash', 'Card', 'QR'])

  const txn = await db.transaction.create({
    data: {
      customerId: customer.id, date, total: cashPortion,
      category: type, method, reference,
      notes: `POS · ${staffMember.name}`,
      lines: { create: [{ catId: cat.id, appointmentId: appt.id, description: service.name, quantity: 1, unitPrice: price, subtotal: price }] },
    },
  })
  if (walletPortion > 0) {
    await db.transaction.create({ data: { customerId: customer.id, date, total: walletPortion, category: type, method: 'Wallet', reference, notes: 'POS wallet portion' } })
    await db.walletEntry.create({ data: { customerId: customer.id, amount: -walletPortion, kind: 'Spend', note: `POS ${reference}`, createdAt: date } })
    liveWalletBalance.set(customer.id, r2(available - walletPortion))
  }
  addPoints(customer.id, Math.floor(price * tierMultiplierFor(customer.id)))
  return { appt, txn, price }
}

// Local mirror of stock levels — decremented alongside the DB write so the
// simulation never oversells a product into negative stock.
const stockLevels = new Map(productList.map(p => [p.id, p.stockQty]))

async function sellRetail(date, customer) {
  const inStock = productList.filter(p => (stockLevels.get(p.id) ?? 0) > 0)
  if (inStock.length === 0) return 0 // everything sold out — skip this sale
  const product = pick(inStock)
  const qty = Math.min(randInt(1, 2), stockLevels.get(product.id))
  const total = r2(product.price * qty)
  const reference = `CD-${randomUUID().slice(0, 8).toUpperCase()}`
  await db.transaction.create({
    data: {
      customerId: customer?.id ?? null, date, total, category: 'Retail', method: pick(['Cash', 'Card', 'QR']), reference,
      notes: 'POS retail',
      lines: { create: [{ productId: product.id, description: product.name, quantity: qty, unitPrice: product.price, subtotal: total }] },
    },
  })
  await db.product.update({ where: { id: product.id }, data: { stockQty: { decrement: qty } } })
  stockLevels.set(product.id, stockLevels.get(product.id) - qty)
  if (customer) addPoints(customer.id, Math.floor(total * tierMultiplierFor(customer.id)))
  return total
}

async function sellMembershipOrAcademyOrOther(category, date) {
  const amounts = { Membership: [399, 599, 699, 999], Academy: [280, 350, 480, 650], Other: [50, 80, 120, 250] }
  const total = pick(amounts[category])
  await db.transaction.create({ data: { date, total, category, method: pick(['Cash', 'Card', 'QR']), notes: `${category} — manual entry` } })
  return total
}

// Track a handful of unpaid Completed visits for the A/R aging demo, spread across buckets
const arCustomers = pickN(customers.filter(c => c.cats.length > 0), 5)
const arAges = [12, 22, 45, 75, 105]

const monthKeysUsed = []
for (let m = 6; m >= 0; m--) {
  const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 15)
  const key = monthKey(monthDate)
  monthKeysUsed.push(key)
  const isCurrent = m === 0
  const dim = daysInMonth(now)
  const dayOfMonth = now.getDate()
  const fullTarget = isCurrent ? 70000 : monthTargets[6 - m]
  const target = isCurrent ? r2(fullTarget * (dayOfMonth / dim)) : fullTarget
  const monthStart = isCurrent ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth() - m, 1)
  const monthEnd = isCurrent ? now : new Date(now.getFullYear(), now.getMonth() - m + 1, 0)
  const spanDays = Math.max(1, Math.round((monthEnd - monthStart) / 86400000))

  const randomDateInMonth = () => atHour(new Date(monthStart.getTime() + Math.random() * spanDays * 86400000), randInt(10, 18), pick([0, 15, 30, 45]))

  process.stdout.write(`  ${key} (target RM${target.toLocaleString()})… `)
  let running = 0
  let guard = 0
  while (running < target && guard < 400) {
    guard++
    const roll = Math.random()
    const date = randomDateInMonth()
    if (roll < REVENUE_CATEGORY_WEIGHTS.Grooming) {
      const c = pick(customers.filter(x => x.cats.length > 0))
      const { price } = await sellGroomingOrBoarding({ type: 'Grooming', date, customer: c, cat: pick(c.cats), useWallet: (liveWalletBalance.get(c.id) ?? 0) > 0 && Math.random() < 0.25 })
      running += price
    } else if (roll < REVENUE_CATEGORY_WEIGHTS.Grooming + REVENUE_CATEGORY_WEIGHTS.Boarding) {
      const c = pick(customers.filter(x => x.cats.length > 0))
      const { price } = await sellGroomingOrBoarding({ type: 'Boarding', date, customer: c, cat: pick(c.cats), useWallet: false })
      running += price
    } else if (roll < REVENUE_CATEGORY_WEIGHTS.Grooming + REVENUE_CATEGORY_WEIGHTS.Boarding + REVENUE_CATEGORY_WEIGHTS.Retail) {
      running += await sellRetail(date, Math.random() > 0.3 ? pick(customers) : null)
    } else if (roll < REVENUE_CATEGORY_WEIGHTS.Grooming + REVENUE_CATEGORY_WEIGHTS.Boarding + REVENUE_CATEGORY_WEIGHTS.Retail + REVENUE_CATEGORY_WEIGHTS.Membership) {
      running += await sellMembershipOrAcademyOrOther('Membership', date)
    } else if (roll < REVENUE_CATEGORY_WEIGHTS.Grooming + REVENUE_CATEGORY_WEIGHTS.Boarding + REVENUE_CATEGORY_WEIGHTS.Retail + REVENUE_CATEGORY_WEIGHTS.Membership + REVENUE_CATEGORY_WEIGHTS.Academy) {
      running += await sellMembershipOrAcademyOrOther('Academy', date)
    } else {
      running += await sellMembershipOrAcademyOrOther('Other', date)
    }
  }
  console.log(`RM${Math.round(running).toLocaleString()} (${guard} sales)`)
  monthlyRevenueActual.set(key, running)
}

// Force two SKUs down to a realistic low-stock state — deliberately AFTER the
// sell-through simulation (not as a starting value) so it never risks going
// negative, and so the numbers reflect genuine depletion rather than a
// hand-picked starting point.
console.log('· Setting up low-stock demo (Products page alert)')
await db.product.update({ where: { id: products['Grooming Brush Deluxe'].id }, data: { stockQty: 2 } })
await db.product.update({ where: { id: products['Ear Cleaning Solution'].id }, data: { stockQty: 1 } })

// Unpaid completed visits — Accounts Receivable demo, across aging buckets
console.log('· Unpaid visits (Accounts Receivable demo)')
for (let i = 0; i < arCustomers.length; i++) {
  const c = arCustomers[i]
  const cat = pick(c.cats)
  const service = pick(groomingServices)
  const date = daysAgo(arAges[i])
  await db.appointment.create({
    data: {
      customerId: c.id, catId: cat.id, type: 'Grooming', serviceId: service.id, staffId: pick(groomers).id,
      scheduledAt: date, endsAt: new Date(date.getTime() + service.durationMin * 60000),
      status: 'Completed', price: service.price, paid: false, createdAt: date, updatedAt: date,
    },
  })
}

// ── 10. Today's Service Board — full flow spread across statuses ───────────
console.log("· Today's Service Board")
const boardStatuses = ['Scheduled', 'Scheduled', 'CheckedIn', 'InService', 'QualityCheck', 'Ready', 'Ready']
const boardCustomers = pickN(customers.filter(c => c.cats.length > 0), boardStatuses.length)
for (let i = 0; i < boardStatuses.length; i++) {
  const c = boardCustomers[i]
  const cat = pick(c.cats)
  const service = pick(groomingServices)
  const hour = 10 + i
  await db.appointment.create({
    data: {
      customerId: c.id, catId: cat.id, type: 'Grooming', serviceId: service.id,
      staffId: boardStatuses[i] === 'Scheduled' ? null : pick(groomers).id,
      scheduledAt: atHour(now, hour), endsAt: atHour(now, hour + 1),
      status: boardStatuses[i], price: service.price, paid: false,
    },
  })
}

// ── 11. Boarding — currently checked in (occupies real rooms) + upcoming ───
console.log('· Boarding stays (checked-in + upcoming)')
const boardingNowCustomers = pickN(customers.filter(c => c.cats.length > 0), 8)
const usedRooms = new Set()
for (let i = 0; i < boardingNowCustomers.length; i++) {
  const c = boardingNowCustomers[i]
  const cat = pick(c.cats)
  const suite = i < 2
  const roomPool = (suite ? suiteRooms : stdRooms).filter(r => !usedRooms.has(r.id))
  const room = roomPool[0]
  usedRooms.add(room.id)
  const nightsIn = randInt(1, 3)
  const nightsMore = randInt(0, 3)
  const service = suite ? boardSuite : boardStd
  const start = daysAgo(nightsIn)
  const end = daysFromNow(nightsMore)
  const totalNights = nightsIn + nightsMore
  await db.appointment.create({
    data: {
      customerId: c.id, catId: cat.id, type: 'Boarding', serviceId: service.id, staffId: staff['Siti Aminah'].id,
      scheduledAt: start, endsAt: end, status: 'CheckedIn', price: r2(service.price * totalNights),
      depositRM: r2(service.price * totalNights * 0.3), paid: false, roomId: room.id,
    },
  })
  await db.room.update({ where: { id: room.id }, data: { status: 'Occupied' } })
}
// A couple of near-future boarding reservations (Room Calendar demo)
for (let i = 0; i < 3; i++) {
  const c = pick(customers.filter(x => x.cats.length > 0))
  const cat = pick(c.cats)
  const roomPool = stdRooms.filter(r => !usedRooms.has(r.id))
  const room = roomPool[randInt(0, roomPool.length - 1)]
  usedRooms.add(room.id)
  const start = daysFromNow(randInt(3, 10))
  const nights = randInt(2, 5)
  await db.appointment.create({
    data: {
      customerId: c.id, catId: cat.id, type: 'Boarding', serviceId: boardStd.id,
      scheduledAt: start, endsAt: new Date(start.getTime() + nights * 86400000),
      status: 'Scheduled', price: r2(boardStd.price * nights), depositRM: 50, paid: false, roomId: room.id,
    },
  })
}

// ── 12. Upcoming grooming appointments (next 10 days) ───────────────────────
console.log('· Upcoming grooming bookings')
for (let i = 0; i < 12; i++) {
  const c = pick(customers.filter(x => x.cats.length > 0))
  const cat = pick(c.cats)
  const service = pick(groomingServices)
  const date = atHour(daysFromNow(randInt(1, 10)), randInt(10, 17))
  await db.appointment.create({
    data: {
      customerId: c.id, catId: cat.id, type: 'Grooming', serviceId: service.id,
      scheduledAt: date, endsAt: new Date(date.getTime() + service.durationMin * 60000),
      status: 'Scheduled', price: service.price, paid: false,
    },
  })
}

// ── 13. Planted records — guarantee the Action Inbox has strong demo content ──
console.log('· Planted Action Inbox triggers')
// VIP arriving today (Gold member, appointment today)
{
  const vip = goldCustomers[0]
  const cat = vip.cats[0]
  await db.appointment.create({
    data: { customerId: vip.id, catId: cat.id, type: 'Grooming', serviceId: services['Full Groom'].id, scheduledAt: atHour(now, 15), endsAt: atHour(now, 16, 30), status: 'Scheduled', price: 180, paid: false },
  })
}
// Win-back candidate: no visit in 120 days, no future booking
{
  const c = customers[customers.length - 1]
  await db.customer.update({ where: { id: c.id }, data: { updatedAt: daysAgo(130) } })
}
// Gold-eligible: high spend, still Essential tier. Dates stay inside the same
// 7-month window as the rest of the revenue history (see §9) — anything older
// would land in a "prior year" the balance sheet/cash-flow never seeded and
// throw off retained earnings.
{
  const c = customers[10]
  for (let i = 0; i < 4; i++) {
    const date = daysAgo(randInt(20, 195))
    await db.transaction.create({ data: { customerId: c.id, date, total: 950, category: 'Grooming', method: 'Card', notes: 'High-value visit' } })
  }
}
// Vaccination expiring very soon
await db.cat.update({ where: { id: customers[3].cats[0].id }, data: { vaccinationExpiry: daysFromNow(6) } })
// Birthday this week
await db.cat.update({ where: { id: customers[12].cats[0].id }, data: { dateOfBirth: new Date(2021, now.getMonth(), Math.min(28, now.getDate() + 3)) } })

// ── 14. Cat assessments (groomer diagnosis / 建档) ─────────────────────────
console.log('· Groomer assessments')
for (const c of pickN(customers.filter(x => x.cats.length > 0), 3)) {
  await db.catAssessment.create({
    data: {
      catId: c.cats[0].id,
      skinCondition: pick(['Healthy', 'Dry', 'Flaky']), coatCondition: pick(['Healthy', 'Dry', 'Heavy shedding']),
      earCondition: pick(['Clean', 'Waxy']), nailCondition: pick(['Trimmed', 'Due']),
      stressLevel: pick(['Low', 'Medium']), weightKg: r2(3 + Math.random() * 3),
      findings: 'Coat in good condition overall; light dryness noted around the shoulders.',
      carePlan: 'Weekly brushing, omega-3 supplement, recheck in 6 weeks.',
      rebookDays: 30, createdAt: daysAgo(randInt(5, 40)),
    },
  })
}

// ── 15. Expenses — 7 months, fixed + variable, with 2 unpaid for A/P demo ───
// Fixed opex is scaled to a growth-stage business (not the mature 5-year Excel
// scale) so it's consistent with the boutique-scale revenue above — early
// months run a small loss, later months turn profitable, a believable arc.
console.log('· Expenses (7 months)')
const FIXED_OPEX = { Rent: 8000, Salaries: 12500, 'Cleaning Supplies': 500, Utilities: 2200, Marketing: 3200, Maintenance: 700 }
const fixedOpexTotal = Object.values(FIXED_OPEX).reduce((a, b) => a + b, 0)
const monthlyCostActual = new Map() // month key -> total COGS+OPEX, for the balance-sheet retained-earnings replay below
for (let m = 6; m >= 0; m--) {
  const date = new Date(now.getFullYear(), now.getMonth() - m, 5, 12)
  const key = monthKey(new Date(now.getFullYear(), now.getMonth() - m, 1))
  for (const [category, amount] of Object.entries(FIXED_OPEX)) {
    await db.expense.create({ data: { date, category, amount, vendor: category === 'Rent' ? 'Menara XYZ Landlord' : category === 'Utilities' ? 'TNB' : null, paid: true } })
  }
  const revenueThatMonth = monthlyRevenueActual.get(key) ?? monthTargets[Math.min(5, 6 - m)]
  const cogsTotal = r2(revenueThatMonth * 0.15)
  await db.expense.create({ data: { date, category: 'Grooming Supplies', amount: r2(cogsTotal * 0.16), vendor: 'OKANA Malaysia', paid: true } })
  await db.expense.create({ data: { date, category: 'Food & Litter', amount: r2(cogsTotal * 0.62), vendor: 'Royal Canin Distributor', paid: true } })
  await db.expense.create({ data: { date, category: 'Vet Visit', amount: r2(cogsTotal * 0.22), vendor: 'PetCare Veterinary Clinic', paid: true } })
  monthlyCostActual.set(key, r2(fixedOpexTotal + cogsTotal))
}
// Unpaid bills — Accounts Payable demo (one overdue, one upcoming)
await db.expense.create({ data: { date: daysAgo(25), category: 'Vet Visit', amount: 640, vendor: 'PetCare Veterinary Clinic', paid: false, dueDate: daysAgo(10) } })
await db.expense.create({ data: { date: daysAgo(3), category: 'Utilities', amount: 4200, vendor: 'TNB', paid: false, dueDate: daysFromNow(12) } })

// ── 16. Business plan + monthly targets (dashboard breakeven widget) ───────
console.log('· Financial plan targets')
const startMonth = monthKeysUsed[0]
const breakevenMonth = monthKey(daysFromNow(365))
await db.businessPlan.create({ data: { id: 'default', startMonth, breakevenMonth, avgSaleValue: 150 } })
for (let m = 6; m >= 0; m--) {
  const key = monthKey(new Date(now.getFullYear(), now.getMonth() - m, 1))
  // Target set a little under what actually happened — shows "ahead of plan" on
  // the Income Statement's Actuals vs Plan strip, a nice demo moment.
  const revenueTarget = (monthlyRevenueActual.get(key) ?? monthTargets[Math.min(5, 6 - m)]) * 0.9
  const costBudget = r2(Object.values(FIXED_OPEX).reduce((a, b) => a + b, 0) + revenueTarget * 0.15)
  await db.monthlyTarget.create({ data: { month: key, revenueTarget: r2(revenueTarget), costBudget } })
}

// ── 17. WhatsApp leads, incidents, cash-ups, academy ────────────────────────
console.log('· WhatsApp leads, incidents, cash-ups, academy')
const waMsg1 = await db.whatsAppMessage.create({ data: { senderPhone: '+60123456789', content: 'Hi, can I book a grooming for my cat this Saturday?', timestamp: daysAgo(1), processed: true } })
await db.whatsAppLead.create({ data: { messageId: waMsg1.id, type: 'BookingRequest', status: 'Pending', summary: 'Customer wants a Saturday grooming slot — no cat/customer on file yet.', confidence: 0.82 } })
const waMsg2 = await db.whatsAppMessage.create({ data: { senderPhone: '+60129876543', content: 'Is the boarding rate still RM80 a night for a standard room?', timestamp: daysAgo(0), processed: true } })
await db.whatsAppLead.create({ data: { messageId: waMsg2.id, type: 'Inquiry', status: 'Pending', summary: 'Pricing inquiry — Standard boarding rate.', confidence: 0.9 } })

await db.incident.create({ data: { type: 'Complaint', description: 'Customer felt drop-off queue was too slow on a Saturday morning.', resolved: true } })
await db.incident.create({ data: { type: 'Safety', description: 'Minor scratch during nail trim — owner informed, no vet visit needed.', resolved: false } })

for (let i = 1; i <= 5; i++) {
  const date = daysAgo(i)
  const expected = r2(1200 + Math.random() * 800)
  const counted = r2(expected + (Math.random() - 0.5) * 40)
  await db.cashUp.create({ data: { date: date.toISOString().slice(0, 10), expectedRM: expected, countedRM: counted, variance: r2(counted - expected), staffName: pick(['Amy Tan', 'Nurul Izzati']) } })
}

await db.academyEnrollment.create({ data: { studentName: 'Jessica Lim', email: 'jessica.lim@example.com', phone: '+60121112222', course: 'Cat Grooming Fundamentals', status: 'Active', enrolledAt: daysAgo(20) } })
await db.academyEnrollment.create({ data: { studentName: 'Daniel Wong', email: 'daniel.wong@example.com', course: 'Feline First Aid', status: 'Completed', enrolledAt: daysAgo(60) } })
await db.academyEnrollment.create({ data: { studentName: 'Ain Syafiqah', email: 'ain.syafiqah@example.com', course: 'Cat Grooming Fundamentals', status: 'Pending', enrolledAt: daysAgo(2) } })

// ── 17b. Inventory — reorder levels + a reconciling movement ledger ─────────
// Each product gets a small StockMovement history (opening + optional restock/
// wastage + a netting sale) that reconciles to its current cached stockQty, so
// the Products detail ledger tells a coherent story. Two SKUs sit below the
// reorder level → low-stock alerts + Action Inbox reorder cards.
console.log('· Inventory movements & reorder levels')
for (const p of productList) {
  const fresh = await db.product.findUnique({ where: { id: p.id }, select: { stockQty: true } })
  const finalQty = fresh.stockQty
  const opening = finalQty + randInt(8, 30)
  const restock = Math.random() < 0.4 ? randInt(20, 60) : 0
  const wastage = Math.random() < 0.3 ? randInt(1, 4) : 0
  const saleQty = opening + restock - wastage - finalQty // reconciles to finalQty
  await db.product.update({ where: { id: p.id }, data: { reorderLevel: 12 } })
  await db.stockMovement.create({ data: { productId: p.id, delta: opening, reason: 'InitialStock', note: 'Opening stock', createdAt: daysAgo(randInt(150, 200)) } })
  if (restock) await db.stockMovement.create({ data: { productId: p.id, delta: restock, reason: 'Restock', reference: `PO-${randInt(1000, 9999)}`, note: 'Supplier delivery', createdAt: daysAgo(randInt(30, 90)) } })
  if (wastage) await db.stockMovement.create({ data: { productId: p.id, delta: -wastage, reason: 'Wastage', note: 'Damaged units', createdAt: daysAgo(randInt(10, 60)) } })
  if (saleQty > 0) await db.stockMovement.create({ data: { productId: p.id, delta: -saleQty, reason: 'Sale', reference: `CD-${randomUUID().slice(0, 6).toUpperCase()}`, createdAt: daysAgo(randInt(1, 40)) } })
}

// ── 17c. HR — attendance (timeclock) ────────────────────────────────────────
console.log('· Staff attendance (clock-in/out)')
const clockStaff = [staff['Wei Xin'], staff['Faris Iskandar'], staff['Siti Aminah'], staff['Nurul Izzati']]
const shopIp = () => `203.0.113.${randInt(2, 250)}`
for (let d = 6; d >= 1; d--) {
  for (const s of clockStaff) {
    if (Math.random() < 0.15) continue // occasional day off
    const inAt = atHour(daysAgo(d), 9, randInt(0, 25))
    const outAt = atHour(daysAgo(d), 18, randInt(0, 45))
    await db.timeEntry.create({ data: { staffId: s.id, clockInAt: inAt, clockOutAt: outAt, onPremiseIn: true, onPremiseOut: true, clockInIp: shopIp(), clockOutIp: shopIp(), createdAt: inAt } })
  }
}
// Currently clocked in today (open shift) — shows as active on the attendance board
for (const s of [staff['Wei Xin'], staff['Siti Aminah']]) {
  await db.timeEntry.create({ data: { staffId: s.id, clockInAt: atHour(now, 9, randInt(5, 30)), onPremiseIn: true, clockInIp: shopIp() } })
}

// ── 17d. HR — leave requests ────────────────────────────────────────────────
console.log('· Leave requests')
const ymd = d => d.toISOString().slice(0, 10)
await db.leaveRequest.create({ data: { staffId: staff['Faris Iskandar'].id, type: 'Annual', startDate: ymd(daysFromNow(9)), endDate: ymd(daysFromNow(12)), days: 4, reason: 'Family trip back to Penang', status: 'Pending' } })
await db.leaveRequest.create({ data: { staffId: staff['Nurul Izzati'].id, type: 'Medical', startDate: ymd(daysFromNow(2)), endDate: ymd(daysFromNow(2)), days: 1, reason: 'Clinic appointment', status: 'Pending' } })
await db.leaveRequest.create({ data: { staffId: staff['Wei Xin'].id, type: 'Annual', startDate: ymd(daysFromNow(4)), endDate: ymd(daysFromNow(6)), days: 3, reason: 'Short break', status: 'Approved', reviewedBy: 'Amy Tan', reviewedAt: daysAgo(2) } })
await db.leaveRequest.create({ data: { staffId: staff['Siti Aminah'].id, type: 'Emergency', startDate: ymd(daysAgo(5)), endDate: ymd(daysAgo(5)), days: 1, reason: 'Family emergency', status: 'Rejected', reviewedBy: 'Amy Tan', reviewedAt: daysAgo(6) } })

// ── 17e. HR — commission rates (per-groomer + a per-service override) ────────
console.log('· Commission rates')
await db.staff.update({ where: { id: staff['Wei Xin'].id }, data: { commissionRatePct: 12 } })
await db.staff.update({ where: { id: staff['Faris Iskandar'].id }, data: { commissionRatePct: 10 } })
await db.service.update({ where: { id: services['De-matting Session'].id }, data: { commissionRatePct: 15 } })
await db.setting.upsert({ where: { key: 'hr.commissionDefaultPct' }, update: { value: '8' }, create: { key: 'hr.commissionDefaultPct', value: '8' } })

// ── 17f. HR — job applications (careers pipeline) ───────────────────────────
console.log('· Job applications')
const applicationDefs = [
  { name: 'Rachel Ng', phone: '+60125550101', email: 'rachel.ng@example.com', roleApplied: 'Groomer', experience: '3 years at a pet spa; certified in Asian-style grooming.', availability: 'Immediately', status: 'New' },
  { name: 'Danish Haziq', phone: '+60125550102', email: 'danish.h@example.com', roleApplied: 'Boarding carer', experience: 'Volunteered at an animal shelter for 2 years; comfortable with anxious cats.', availability: '2 weeks notice', status: 'Reviewing' },
  { name: 'Michelle Tan', phone: '+60125550103', roleApplied: 'Front desk', experience: 'Retail + customer-service background, fluent in EN/BM/中文.', availability: 'Weekdays', status: 'Interview' },
  { name: 'Kamal Idris', phone: '+60125550104', email: 'kamal.i@example.com', roleApplied: 'Groomer', experience: 'Fresh graduate, eager to learn grooming.', availability: 'Immediately', status: 'Rejected' },
]
for (const a of applicationDefs) {
  const d = daysAgo(randInt(1, 25))
  await db.jobApplication.create({ data: { ...a, createdAt: d, updatedAt: d, reviewedAt: a.status === 'New' ? null : d } })
}

// ── 17g. Digital receipts — public tokenised links on recent grooming sales ──
console.log('· Digital receipts (public links)')
const receiptTx = await db.transaction.findMany({ where: { category: 'Grooming', customerId: { not: null } }, orderBy: { date: 'desc' }, take: 5 })
for (const tx of receiptTx) {
  await db.transaction.update({ where: { id: tx.id }, data: { publicToken: randomUUID().replace(/-/g, '').slice(0, 24), receiptSentAt: daysAgo(randInt(0, 5)), receiptChannel: 'WhatsApp' } })
}

// ── 17h. Audit log — a few sensitive-action entries ─────────────────────────
console.log('· Audit log entries')
await db.auditLog.create({ data: { actorKind: 'manager', actorName: 'Owner', action: 'wallet.topup', entityType: 'Customer', entityId: customers[0].id, summary: 'Wallet top-up RM 500.00 (+RM 50.00 bonus)', at: daysAgo(3) } })
await db.auditLog.create({ data: { actorKind: 'manager', actorName: 'Owner', action: 'loyalty.adjust', entityType: 'Customer', entityId: customers[1].id, summary: 'Awarded 200 pts (Manual)', at: daysAgo(2) } })
await db.auditLog.create({ data: { actorKind: 'staff', actorName: 'Amy Tan', action: 'leave.approve', entityType: 'LeaveRequest', summary: 'Approved Annual leave for Wei Xin (3 days)', at: daysAgo(2) } })
await db.auditLog.create({ data: { actorKind: 'manager', actorName: 'Owner', action: 'staff.reset_pin', entityType: 'Staff', entityId: staff['Nurul Izzati'].id, summary: 'Reset PIN for Nurul Izzati', at: daysAgo(1) } })

// ── 18. Flush accumulated points / wallet balances onto customers ──────────
console.log('· Finalizing points & wallet balances')
for (const [customerId, points] of pointsBalanceDelta) {
  await db.customer.update({ where: { id: customerId }, data: { pointsBalance: { increment: points } } })
}
// liveWalletBalance already nets top-ups minus every spend made during
// generation, so this is a direct SET — never an increment (that would double-count).
for (const [customerId, balance] of liveWalletBalance) {
  await db.customer.update({ where: { id: customerId }, data: { walletBalance: balance } })
}

// ── 19. Balance sheet — key cash & capital so it balances out of the box ───
// Mirrors lib/balance-sheet.ts's real auto-derivation exactly: receivables,
// wallet liability, payables, AND retained earnings are all read straight back
// out of the database via the same aggregate math the app itself uses (a
// flat sum of Transaction.total per month equals Total Revenue regardless of
// category, since every category — including the 'Other' catch-all — feeds
// the same total; COGS/OPEX categories mirror lib/finance-categories.ts).
// This can't drift from the live page the way a separately-tracked running
// estimate could. The only unknown solved for is cash, so Assets = Liabilities
// + Equity for every month in the demo window. Owner capital is a stable
// RM150,000 in every month (a believable one-time injection for a 61-room facility).
console.log('· Balancing the balance sheet (keying cash & capital)')
const OWNER_CAPITAL = 150000
const COGS_CATS = ['Grooming Supplies', 'Food & Litter', 'Vet Visit', 'Retail Stock']
const OPEX_CATS = ['Rent', 'Salaries', 'Cleaning Supplies', 'Utilities', 'Marketing', 'Maintenance', 'Other Expense']
const allProducts = await db.product.findMany({ where: { active: true }, select: { stockQty: true, costPrice: true } })
const inventoryAtCost = r2(allProducts.reduce((s, p) => s + p.stockQty * p.costPrice, 0))

let cumulativeNet = 0
for (let m = 6; m >= 0; m--) {
  const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1)
  const key = monthKey(monthStart)
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1) // exclusive month-end boundary

  const [revAgg, cogsAgg, opexAgg, receivablesAgg, walletAgg, payablesAgg] = await Promise.all([
    db.transaction.aggregate({ _sum: { total: true }, where: { date: { gte: monthStart, lt: end } } }),
    db.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: monthStart, lt: end }, category: { in: COGS_CATS } } }),
    db.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: monthStart, lt: end }, category: { in: OPEX_CATS } } }),
    db.appointment.aggregate({ _sum: { price: true }, where: { status: 'Completed', paid: false, price: { not: null }, scheduledAt: { lt: end } } }),
    db.walletEntry.aggregate({ _sum: { amount: true }, where: { createdAt: { lt: end } } }),
    db.expense.aggregate({ _sum: { amount: true }, where: { paid: false, date: { lt: end } } }),
  ])
  const ebitda = r2((revAgg._sum.total ?? 0) - (cogsAgg._sum.amount ?? 0) - (opexAgg._sum.amount ?? 0))
  const tax = ebitda > 0 ? r2(ebitda * 0.24) : 0
  cumulativeNet = r2(cumulativeNet + (ebitda - tax))

  const receivables = r2(receivablesAgg._sum.price ?? 0)
  const walletLiability = r2(walletAgg._sum.amount ?? 0)
  const payables = r2(payablesAgg._sum.amount ?? 0)

  // Solve: assets = liabilities + equity
  //   cash + receivables + inventory = payables + wallet + capital + retainedEarnings
  const cash = r2(payables + walletLiability + OWNER_CAPITAL + cumulativeNet - receivables - inventoryAtCost)

  await db.balanceSheetCell.create({ data: { asOf: key, lineKey: 'a.cash', amount: cash } })
  await db.balanceSheetCell.create({ data: { asOf: key, lineKey: 'e.capital', amount: OWNER_CAPITAL } })
}

// ── Summary ──────────────────────────────────────────────────────────────
const [custCount, catCount, apptCount, txnCount, expCount] = await Promise.all([
  db.customer.count(), db.cat.count(), db.appointment.count(), db.transaction.count(), db.expense.count(),
])
const [moveCount, lowCount, timeCount, leaveCount, appCount, receiptCount, auditCount] = await Promise.all([
  db.stockMovement.count(),
  db.product.count({ where: { reorderLevel: { not: null }, stockQty: { lte: 12 } } }),
  db.timeEntry.count(), db.leaveRequest.count(), db.jobApplication.count(),
  db.transaction.count({ where: { publicToken: { not: null } } }), db.auditLog.count(),
])
console.log('\n✓ Demo data seeded:')
console.log(`  ${custCount} customers · ${catCount} cats · ${apptCount} appointments · ${txnCount} transactions · ${expCount} expenses`)
console.log(`  ${moveCount} stock movements (${lowCount} low-stock) · ${timeCount} time entries · ${leaveCount} leave requests`)
console.log(`  ${appCount} job applications · ${receiptCount} digital receipts · ${auditCount} audit entries`)
console.log('\nStaff PIN logins:')
for (const s of staffDefs) console.log(`  ${s.name.padEnd(16)} ${s.role.padEnd(10)} PIN ${s.pin}`)

// All writes are already committed to the SQLite file at this point — skip
// db.$disconnect() and exit directly. The libsql native binding's cleanup path
// segfaults on process exit on this platform; it's harmless (happens after
// every write is flushed) but noisy, so avoid triggering it at all.
process.exit(0)
