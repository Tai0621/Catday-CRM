import { readFileSync, existsSync } from 'node:fs'

// One env loader for every local runner, because two of them disagreeing is not
// a theoretical risk — it cost a day.
//
// `.env` is a dotenv file (KEY=value); `.env.demo.sh` is a shell file
// (export KEY=value). Both are read here, in that order, so the demo overlay
// wins — including on APP_PASSWORD, which the demo deployment does not share
// with production.
//
// ENCODING IS THE TRAP. A line appended to `.env.demo.sh` by PowerShell is
// UTF-16LE (`Add-Content` and `>>` default to it), so it reads back as
// "e\0x\0p\0o\0r\0t\0" and matches no ASCII regex — `grep` cannot find it and a
// naive parser skips it silently. Bash `source` executes it regardless. The
// result was a server holding one password while the verify scripts sent
// another, with nothing on either side able to see the line responsible.

/** Decode a file whether it was written UTF-8 or UTF-16 (with or without BOM). */
export function readTextFile(file) {
  const buf = readFileSync(file)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le', 2)
  // No BOM: a NUL in the first stretch of an env file means UTF-16LE text.
  if (buf.subarray(0, 200).includes(0x00)) return buf.toString('utf16le')
  return buf.toString('utf8')
}

/** Parse either `KEY=value` or `export KEY=value`, one layer of quotes stripped. */
export function parseEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readTextFile(file).split(/\r?\n/)) {
    // Strip stray NULs and carriage returns so a mixed-encoding file still
    // yields usable keys. Both matter: a UTF-16 line decoded as UTF-8 leaves
    // NULs between every character, and its CRLF survives the split as a
    // trailing `\r` — which `.*` cannot consume, because `.` excludes line
    // terminators. That alone made the line parse as nothing.
    const line = raw.replace(/[\0\r]/g, '')
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  }
  return out
}

/**
 * The environment a local demo run should have: process env, then `.env`, then
 * the demo overlay. Later wins, so the overlay decides the database AND the
 * password — server and test scripts alike.
 */
export function demoEnv(extraFiles = []) {
  return {
    ...process.env,
    ...parseEnvFile('.env'),
    ...parseEnvFile('.env.demo.sh'),
    ...extraFiles.reduce((acc, f) => ({ ...acc, ...parseEnvFile(f) }), {}),
  }
}
