import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function safe(sql, label) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') {
    const msg = r.error?.message ?? ''
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(msg)
  }
  console.log(`  ✓ ${label}`)
}

console.log('Cat health & feeding-profile migration…')

await safe(`ALTER TABLE "Cat" ADD COLUMN "lastDewormAt" DATETIME`, 'Cat.lastDewormAt')
await safe(`ALTER TABLE "Cat" ADD COLUMN "lastDefleaAt" DATETIME`, 'Cat.lastDefleaAt')
await safe(`ALTER TABLE "Cat" ADD COLUMN "dietType" TEXT`, 'Cat.dietType')
await safe(`ALTER TABLE "Cat" ADD COLUMN "mealsPerDay" INTEGER`, 'Cat.mealsPerDay')
await safe(`ALTER TABLE "Cat" ADD COLUMN "portion" TEXT`, 'Cat.portion')
await safe(`ALTER TABLE "Cat" ADD COLUMN "feedingNotes" TEXT`, 'Cat.feedingNotes')
await safe(`ALTER TABLE "Cat" ADD COLUMN "medication" TEXT`, 'Cat.medication')

console.log('done — deworm/deflea + feeding profile columns ready.')
