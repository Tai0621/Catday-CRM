import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { listRoles, UNRESTRICTED } from '@/lib/roles-store'
import { RoleEditor, type EditableRole } from './RoleEditor'

// Roles & Access — Human Resource.
//
// The four roles used to be a union type in the source, so "can a groomer see
// the finances?" was a question only a developer could answer. It is now a
// screen the owner reads and edits.

export default async function RolesPage() {
  await requireManager()

  const [roles, staff] = await Promise.all([
    listRoles(),
    db.staff.groupBy({ by: ['role'], where: { active: true }, _count: true }),
  ])
  const counts = new Map(staff.map(s => [s.role, s._count]))

  const editable: EditableRole[] = roles.map(r => ({
    id: r.key, // the store keys by `key`; the actions look the row up by id
    key: r.key,
    label: r.label,
    homePath: r.homePath,
    paths: r.paths.filter(p => p !== UNRESTRICTED),
    isSystem: r.isSystem,
    staffCount: counts.get(r.key) ?? 0,
  }))

  // The actions take the database id, not the key. Resolve it here rather than
  // trusting whatever the browser sends back as an id.
  const rows = await db.staffRoleDef.findMany({ select: { id: true, key: true } }).catch(() => [])
  const idByKey = new Map(rows.map(r => [r.key, r.id]))
  for (const r of editable) r.id = idByKey.get(r.key) ?? r.key

  const unmigrated = rows.length === 0

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Roles &amp; Access</h1>
        <p className="text-sm cd-muted">Who can open what. Add a role, then tick the tabs it should see.</p>
      </div>

      {unmigrated ? (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            This deployment is still on the built-in roles — the database has not had{' '}
            <code>scripts/migrate-staff-roles.mjs</code> run against it yet. Access works exactly as before;
            editing becomes available once the migration has run.
          </p>
        </div>
      ) : (
        <RoleEditor roles={editable} />
      )}
    </div>
  )
}
