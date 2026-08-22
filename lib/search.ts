import { db } from './db'
import { canAccess } from './roles-store'
import { ALL_TABS, segmentLabel } from './nav-catalogue'
import { LIVE_CUSTOMER, CAT_NOT_HOUSE, NOT_HOUSE } from './cat-stock'
import { displayPhone } from './phone'

// What the command palette searches.
//
// ── The rule, and why it is the whole design ─────────────────────────────────
//
// A result is returned only if the session could OPEN THE PAGE that result
// links to. Not "the row exists", not "the query matched" — `canAccess` on the
// destination, which already applies MANAGER_ONLY_PATHS before a role's own
// prefix list.
//
// This matters more here than anywhere else in the OS. Every other screen is a
// page: if a groomer cannot open /customers, they never see a customer. A
// search box reaches ACROSS all of that at once, so without this rule the
// palette becomes a way to read the names, phone numbers and spend of people
// whose page you are not allowed to open — and it would look like it was
// working perfectly.
//
// So each source below declares the path it needs, filtering happens on the
// SERVER before anything is serialised, and scripts/verify-search.mjs follows
// every href it hands out to confirm none of them bounce.
//
// A search costs one round trip per accessible source (see docs/PERFORMANCE.md
// — queries are serialised), which is why the sources a role cannot reach are
// never queried at all rather than queried and filtered.

export interface SearchItem {
  id: string
  title: string
  subtitle?: string
  href: string
}

export interface SearchGroup {
  key: string
  /** Shown as the group heading. */
  label: string
  /** Which part of the OS this came from — the owner asked to see this. */
  section?: string
  items: SearchItem[]
}

/**
 * Below this, searching is not useful and is expensive: one character matches
 * most of the database, and returning it would both leak volume and make the
 * palette feel like it is guessing.
 */
const MIN_QUERY = 2
const PER_GROUP = 6

/** A data source, and the page a reader must be able to open to see it. */
interface Source {
  key: string
  label: string
  /** The access this source requires. Checked with `canAccess`, never assumed. */
  requires: string
  load: (q: string) => Promise<SearchItem[]>
}

const SOURCES: Source[] = [
  {
    key: 'customers',
    label: 'Customers',
    requires: '/customers',
    load: async q => {
      const rows = await db.customer.findMany({
        // Erased customers stay erased: the palette must not be the one place
        // an anonymised person comes back. House records are not people.
        where: {
          ...LIVE_CUSTOMER,
          OR: [{ name: { contains: q } }, { phone: { contains: q } }],
        },
        select: { id: true, name: true, phone: true },
        take: PER_GROUP,
      })
      return rows.map(c => ({
        id: c.id,
        title: c.name ?? displayPhone(c.phone),
        subtitle: c.name ? displayPhone(c.phone) : undefined,
        href: `/customers/${c.id}`,
      }))
    },
  },
  {
    key: 'cats',
    label: 'Cats',
    requires: '/cats',
    load: async q => {
      const rows = await db.cat.findMany({
        where: { ...CAT_NOT_HOUSE, name: { contains: q } },
        select: { id: true, name: true, breed: true, customer: { select: { name: true } } },
        take: PER_GROUP,
      })
      return rows.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: [c.breed, c.customer?.name].filter(Boolean).join(' · ') || undefined,
        href: `/cats/${c.id}`,
      }))
    },
  },
  {
    key: 'rooms',
    label: 'Rooms',
    requires: '/rooms',
    load: async q => {
      const rows = await db.room.findMany({
        where: { isActive: true, name: { contains: q } },
        select: { id: true, name: true, type: true, status: true },
        take: PER_GROUP,
      })
      return rows.map(r => ({
        id: r.id,
        title: r.name,
        subtitle: `${r.type} · ${r.status}`,
        href: `/rooms/${r.id}`,
      }))
    },
  },
  {
    key: 'products',
    label: 'Products',
    requires: '/inventory/products',
    load: async q => {
      const rows = await db.product.findMany({
        where: { name: { contains: q } },
        select: { id: true, name: true, price: true, stockQty: true },
        take: PER_GROUP,
      })
      return rows.map(p => ({
        id: p.id,
        title: p.name,
        subtitle: `RM ${p.price.toFixed(2)} · ${p.stockQty} in stock`,
        href: `/inventory/products/${p.id}`,
      }))
    },
  },
  {
    key: 'staff',
    label: 'Staff',
    requires: '/staff',
    load: async q => {
      const rows = await db.staff.findMany({
        where: { name: { contains: q } },
        select: { id: true, name: true, role: true, active: true },
        take: PER_GROUP,
      })
      return rows.map(s => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.role}${s.active ? '' : ' · inactive'}`,
        href: `/staff`,
      }))
    },
  },
]

/**
 * Search everything this role may reach.
 *
 * Pages first: the palette's main job is jumping, and 83 pages behind eight
 * collapsible groups is why it exists. Data follows, grouped by where it lives.
 */
export async function search(roleKey: string, rawQuery: string): Promise<SearchGroup[]> {
  const q = rawQuery.trim()
  if (q.length < MIN_QUERY) return []
  const needle = q.toLowerCase()

  const groups: SearchGroup[] = []

  // ── Pages ──
  const allowedTabs: SearchItem[] = []
  for (const tab of ALL_TABS) {
    if (!tab.label.toLowerCase().includes(needle)) continue
    if (!(await canAccess(roleKey, tab.href))) continue
    allowedTabs.push({
      id: tab.href,
      title: tab.label,
      subtitle: segmentLabel(tab.href),
      href: tab.href,
    })
    if (allowedTabs.length >= PER_GROUP) break
  }
  if (allowedTabs.length > 0) groups.push({ key: 'pages', label: 'Pages', items: allowedTabs })

  // ── Data ──
  //
  // A source the role cannot reach is never QUERIED, not queried and filtered.
  // That is both the access rule and the reason a groomer's search is faster
  // than a manager's.
  for (const source of SOURCES) {
    if (!(await canAccess(roleKey, source.requires))) continue
    const items = await source.load(q)
    if (items.length === 0) continue
    groups.push({
      key: source.key,
      label: source.label,
      section: segmentLabel(source.requires),
      items,
    })
  }

  return groups
}

/** The role key a session searches as. Managers search as the Manager role. */
export function roleKeyFor(session: { kind: string; role?: string }): string {
  return session.kind === 'manager' ? 'Manager' : (session.role ?? '')
}

// Re-exported so the API route does not reach past this module for the filter.
export { NOT_HOUSE }
