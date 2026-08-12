'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ALL_TABS, ALWAYS_ALLOWED_PATHS, pathAllowed } from '@/lib/nav-catalogue'
import { UNRESTRICTED } from '@/lib/roles-store'
import { revalidatePath } from 'next/cache'

// Owner-defined roles.
//
// Every write here is manager-only and re-validated server-side. The form is a
// list of checkboxes, so a hand-crafted POST is the obvious way to try to grant
// something that was never offered — hence the allow-list check below rather
// than trusting whatever came back.

export type RoleResult = { ok: true; message: string } | { ok: false; error: string }
const fail = (error: string): RoleResult => ({ ok: false, error })

const VALID_TAB_HREFS = new Set(ALL_TABS.map(t => t.href))

/** `a-z0-9` and dashes, so the key is safe to store on Staff.role and compare. */
function toKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

function readPaths(data: FormData): string[] {
  // Only hrefs the catalogue actually offers. Anything else — an /api route, a
  // path someone typed into the DOM — is dropped rather than stored, so a
  // crafted submission cannot widen access beyond what the UI can express.
  return data.getAll('paths').map(String).filter(p => VALID_TAB_HREFS.has(p))
}

export async function createRole(data: FormData): Promise<RoleResult> {
  await requireManager()

  const label = String(data.get('label') ?? '').trim()
  if (!label) return fail('Give the role a name.')
  const key = toKey(String(data.get('key') ?? '') || label)
  if (!key) return fail('That name has no letters or numbers in it.')

  const clash = await db.staffRoleDef.findUnique({ where: { key } })
  if (clash) return fail(`A role called "${clash.label}" already uses that name.`)

  const paths = readPaths(data)
  if (paths.length === 0) return fail('Tick at least one tab — a role that can open nothing cannot work a shift.')

  const homePath = String(data.get('homePath') ?? '').trim() || paths[0]
  if (!isReachable(homePath, paths)) {
    return fail('The landing page must be one of the tabs this role can open, or they would be bounced away from it on every login.')
  }

  const count = await db.staffRoleDef.count()
  const role = await db.staffRoleDef.create({
    data: { key, label, homePath, paths: JSON.stringify(paths), isSystem: false, sortOrder: count, active: true },
  })

  await recordAudit({
    action: 'role.create', entityType: 'StaffRoleDef', entityId: role.id,
    summary: `Role "${label}" created with ${paths.length} tab${paths.length === 1 ? '' : 's'}`,
    detail: { key, homePath, paths },
  })
  revalidatePath('/hr/roles')
  return { ok: true, message: `"${label}" created.` }
}

export async function updateRole(data: FormData): Promise<RoleResult> {
  await requireManager()

  const id = String(data.get('id') ?? '')
  const role = await db.staffRoleDef.findUnique({ where: { id } })
  if (!role) return fail('That role no longer exists.')
  if (role.isSystem) {
    return fail(`"${role.label}" is the owner's own access and cannot be narrowed — that is how someone locks themselves out.`)
  }

  const label = String(data.get('label') ?? '').trim() || role.label
  const paths = readPaths(data)
  if (paths.length === 0) return fail('Tick at least one tab — a role that can open nothing cannot work a shift.')

  const homePath = String(data.get('homePath') ?? '').trim() || paths[0]
  if (!isReachable(homePath, paths)) {
    return fail('The landing page must be one of the tabs this role can open, or they would be bounced away from it on every login.')
  }

  const before = JSON.parse(role.paths) as string[]
  await db.staffRoleDef.update({ where: { id }, data: { label, homePath, paths: JSON.stringify(paths) } })

  // Named both ways: "what did we take away" is the question asked when someone
  // reports they can no longer do their job.
  const removed = before.filter(p => !paths.includes(p))
  const added = paths.filter(p => !before.includes(p))
  await recordAudit({
    action: 'role.update', entityType: 'StaffRoleDef', entityId: id,
    summary: `Role "${label}" updated — ${added.length} added, ${removed.length} removed`,
    detail: { added, removed, homePath },
  })
  revalidatePath('/hr/roles')
  return {
    ok: true,
    message: removed.length > 0
      ? `"${label}" saved. ${removed.length} tab${removed.length === 1 ? '' : 's'} removed — anyone signed in on this role loses access immediately.`
      : `"${label}" saved.`,
  }
}

export async function deleteRole(data: FormData): Promise<RoleResult> {
  await requireManager()

  const id = String(data.get('id') ?? '')
  const role = await db.staffRoleDef.findUnique({ where: { id } })
  if (!role) return fail('That role no longer exists.')
  if (role.isSystem) return fail(`"${role.label}" is built in and cannot be deleted.`)

  // A staff row stores the role KEY. Deleting a role out from under someone
  // would leave them with a role that resolves to nothing — default-deny, so
  // they could not open a single page and the cause would not be obvious.
  const holders = await db.staff.count({ where: { role: role.key, active: true } })
  if (holders > 0) {
    return fail(`${holders} staff member${holders === 1 ? ' is' : 's are'} on "${role.label}". Move them to another role first.`)
  }

  await db.staffRoleDef.delete({ where: { id } })
  await recordAudit({
    action: 'role.delete', entityType: 'StaffRoleDef', entityId: id,
    summary: `Role "${role.label}" deleted`,
  })
  revalidatePath('/hr/roles')
  return { ok: true, message: `"${role.label}" deleted.` }
}

/**
 * Could someone on this role actually open their landing page?
 *
 * If not, login sends them there, access control bounces them back to it, and
 * they ping-pong — a redirect loop that reads as the app being broken rather
 * than as a setting being wrong.
 */
function isReachable(homePath: string, paths: string[]): boolean {
  if (paths.includes(UNRESTRICTED)) return true
  return pathAllowed(homePath, [...ALWAYS_ALLOWED_PATHS, ...paths])
}
