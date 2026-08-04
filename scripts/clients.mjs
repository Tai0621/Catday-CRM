import { readFileSync, existsSync } from 'node:fs'

// ── The tenant registry ──────────────────────────────────────────────────────
// Bizkit is single-tenant per deployment: one client, one database, one Vercel
// project. That is the product's core promise — a client's data never shares a
// table with anyone else's — but it means a schema change has to be applied to
// every client database individually.
//
// Deploys, by contrast, are shared: every client project builds from `main`, so
// one push updates them all at once. Migrating one client and pushing would
// therefore break all the others simultaneously. This registry is what makes the
// fan-out possible; scripts/migrate-all.mjs is what performs it.
//
// clients.json holds every tenant's database credentials, so it is gitignored.
// See clients.example.json for the shape.

const FILE = 'clients.json'

export function loadClients() {
  const raw = process.env.BIZKIT_CLIENTS ?? (existsSync(FILE) ? readFileSync(FILE, 'utf8') : null)
  if (!raw) {
    throw new Error(
      `No tenant registry found.\n` +
      `  Create ${FILE} (see clients.example.json), or set BIZKIT_CLIENTS to the same JSON.\n` +
      `  ${FILE} is gitignored — it holds every client's database token.`,
    )
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Tenant registry is not valid JSON: ${e.message}`)
  }

  const clients = Array.isArray(parsed) ? parsed : parsed.clients
  if (!Array.isArray(clients) || clients.length === 0) {
    throw new Error(`Tenant registry has no clients.`)
  }

  const seen = new Set()
  for (const c of clients) {
    for (const field of ['slug', 'name', 'databaseUrl', 'authToken']) {
      if (!c[field]) throw new Error(`Client "${c.slug ?? '?'}" is missing "${field}".`)
    }
    if (seen.has(c.slug)) throw new Error(`Duplicate client slug "${c.slug}".`)
    seen.add(c.slug)
    // Anything not explicitly marked demo is treated as live, so a forgotten
    // field fails safe (extra confirmation) rather than silently unsafe.
    c.env = c.env === 'demo' ? 'demo' : 'production'
  }
  return clients
}

/** Never print a client's full database URL — it embeds the tenant's host. */
export const redact = url => String(url).replace(/^(libsql:\/\/[^.]{0,6})[^.]*/, '$1…')

export function selectClients(clients, { only, skip, envOnly } = {}) {
  let out = clients
  if (only) {
    const wanted = new Set(only.split(',').map(s => s.trim()).filter(Boolean))
    for (const slug of wanted) {
      if (!out.some(c => c.slug === slug)) throw new Error(`Unknown client "${slug}".`)
    }
    out = out.filter(c => wanted.has(c.slug))
  }
  if (skip) {
    const unwanted = new Set(skip.split(',').map(s => s.trim()).filter(Boolean))
    out = out.filter(c => !unwanted.has(c.slug))
  }
  if (envOnly) out = out.filter(c => c.env === envOnly)
  return out
}
