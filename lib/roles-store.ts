import { cache } from 'react'
import { db } from './db'
import { ALWAYS_ALLOWED_PATHS, pathAllowed } from './nav-catalogue'
import { ROLE_HOME, STAFF_ROLE_PATHS, isManagerOnly } from './roles'
import { parseLayout, resolveNav, emptyLayout, type NavLayout, type ResolvedNav } from './nav-layout'

// Owner-defined roles, read live.
//
// Live and not from the session token on purpose: the token lasts 30 days, so
// permissions baked into it would let a tab the owner just revoked keep opening
// for a month. The cost is a query per request, wrapped in React's `cache` so a
// single render reads it once.

/** `*` in a role's paths means unrestricted — the Manager role. */
export const UNRESTRICTED = '*'

export interface RoleDef {
  key: string
  label: string
  homePath: string
  paths: string[]
  isSystem: boolean
  sortOrder: number
  active: boolean
  layout: NavLayout
}

function parsePaths(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

/**
 * Every role, or the hardcoded defaults when the table is not there yet.
 *
 * The fallback matters more than it looks. A deployment that has the new code
 * but has not run the migration must behave EXACTLY as it did before — falling
 * back to deny would lock every staff member out of their own shift, and
 * falling back to allow would hand a groomer the finances. Neither failure
 * announces itself, so the fallback is the pre-existing rules verbatim.
 */
export const listRoles = cache(async (): Promise<RoleDef[]> => {
  try {
    const rows = await db.staffRoleDef.findMany({ orderBy: { sortOrder: 'asc' } })
    if (rows.length > 0) {
      return rows.map(r => ({
        key: r.key, label: r.label, homePath: r.homePath, paths: parsePaths(r.paths),
        isSystem: r.isSystem, sortOrder: r.sortOrder, active: r.active,
        layout: parseLayout(r.layout),
      }))
    }
  } catch {
    // Table absent (migration not run) — fall through to the built-in defaults.
  }
  return [
    { key: 'Manager', label: 'Store Manager', homePath: '/', paths: [UNRESTRICTED], isSystem: true, sortOrder: 0, active: true, layout: emptyLayout() },
    ...Object.entries(STAFF_ROLE_PATHS).map(([key, paths], n) => ({
      key, label: key, homePath: ROLE_HOME[key] ?? '/board',
      paths, isSystem: false, sortOrder: n + 1, active: true, layout: emptyLayout(),
    })),
  ]
})

export const roleByKey = cache(async (key: string): Promise<RoleDef | null> => {
  const all = await listRoles()
  return all.find(r => r.key === key) ?? null
})

/** Where a role lands after login, and where a blocked page sends it. */
export async function homeFor(key: string): Promise<string> {
  const role = await roleByKey(key)
  return role?.homePath || ROLE_HOME[key] || '/board'
}

/**
 * May this role open `pathname`?
 *
 * Default-deny: an unknown role, an inactive one, or one with no paths gets
 * nothing beyond the always-allowed set. A role the owner deleted while someone
 * was signed in therefore stops working immediately rather than inheriting
 * whatever the last role in the list happened to allow.
 */
export async function canAccess(key: string, pathname: string): Promise<boolean> {
  if (pathAllowed(pathname, ALWAYS_ALLOWED_PATHS)) return true
  const role = await roleByKey(key)
  if (!role || !role.active) return false
  if (role.paths.includes(UNRESTRICTED)) return true
  // The manager-only floor is checked BEFORE the role's own list, because the
  // list is prefix-matched: granting `/memberships` to reception would
  // otherwise also grant the tier PRICING page beneath it. This is the check
  // that used to live in proxy.ts, and moving page enforcement here without it
  // handed exactly that page over.
  if (isManagerOnly(pathname)) return false
  return pathAllowed(pathname, role.paths)
}

/** The tabs a role may see, for the Nav. Unrestricted returns null (= everything). */
export async function visiblePaths(key: string): Promise<string[] | null> {
  const role = await roleByKey(key)
  if (!role || !role.active) return []
  if (role.paths.includes(UNRESTRICTED)) return null
  return role.paths
}

/**
 * The staff sidebar: pinned tabs, then named drop-downs.
 *
 * Resolved server-side from the role's own arrangement, filtered by what it may
 * open. A tab granted but never filed anywhere still appears — see resolveNav —
 * because a tick that grants access to something with no way to reach it looks
 * like the tick did not work.
 */
export async function navFor(key: string): Promise<ResolvedNav> {
  const role = await roleByKey(key)
  if (!role || !role.active) return { pinned: [], groups: [] }
  return resolveNav(role.paths, role.layout, role.paths.includes(UNRESTRICTED))
}
