import { put } from '@vercel/blob'

// Server-side logical backup used by the scheduled cron (/api/cron/backup).
// Dumps every table to JSON via the Turso HTTP pipeline and uploads it to Vercel
// Blob. The local dev equivalent is scripts/backup-db.mjs.

const RAW = process.env.DATABASE_URL ?? ''
const TOKEN = process.env.DATABASE_AUTH_TOKEN ?? ''
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

type Cell = { type: string; value?: string }
type PipeResult = { response: { result: { cols: { name: string }[]; rows: Cell[][] } } }

async function pipe(sqls: string[]): Promise<PipeResult[]> {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...sqls.map(sql => ({ type: 'execute', stmt: { sql } })), { type: 'close' }] }),
  })
  const j = await res.json()
  const e = j.results?.find((x: { type?: string }) => x?.type === 'error')
  if (e) throw new Error(e.error?.message ?? 'pipeline error')
  return j.results
}

export async function dumpDatabase(): Promise<{ json: string; tables: number; rows: number; stamp: string }> {
  const [tablesRes] = await pipe([
    `SELECT name FROM sqlite_master WHERE type='table'
      AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'
      ORDER BY name`,
  ])
  const names = tablesRes.response.result.rows.map(r => r[0].value as string)

  const dump: { generatedAt: string; tables: Record<string, { columns: string[]; rows: Cell[][] }> } = {
    generatedAt: new Date().toISOString(),
    tables: {},
  }
  let rows = 0
  for (const name of names) {
    const [res] = await pipe([`SELECT * FROM "${name}"`])
    const r = res.response.result
    dump.tables[name] = { columns: r.cols.map(c => c.name), rows: r.rows }
    rows += r.rows.length
  }
  return { json: JSON.stringify(dump), tables: names.length, rows, stamp: new Date().toISOString().replace(/[:.]/g, '-') }
}

export type BackupResult =
  | { ok: true; pathname: string; tables: number; rows: number }
  | { ok: false; error: string }

export async function runBackupToBlob(): Promise<BackupResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { ok: false, error: 'BLOB_READ_WRITE_TOKEN not set' }
  const { json, tables, rows, stamp } = await dumpDatabase()
  const blob = await put(`backups/backup-${stamp}.json`, json, {
    access: 'private', contentType: 'application/json', token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  return { ok: true, pathname: blob.pathname, tables, rows }
}
