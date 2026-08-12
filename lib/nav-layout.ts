import { ALL_TABS, ALWAYS_ALLOWED, pathAllowed, type NavLink } from './nav-catalogue'

// How a staff member's sidebar is arranged: a few pinned tabs, then named
// drop-downs.
//
// LAYOUT IS PRESENTATION, ACCESS IS `paths`. They are deliberately two fields
// on the role and never merged. If arranging the sidebar also decided
// permissions, dragging a tab into a group would quietly grant or revoke it —
// and the owner would have no reason to think they had changed anything but the
// order.
//
// Depends only on the catalogue (itself import-free), so this compiles and runs
// standalone under tsc for direct testing.

export interface NavGroupLayout { label: string; paths: string[] }
export interface NavLayout {
  /** Sits above the groups, always visible. */
  pinned: string[]
  groups: NavGroupLayout[]
}

export interface ResolvedNav {
  pinned: NavLink[]
  groups: { label: string; links: NavLink[] }[]
}

/** Where anything granted but unplaced ends up. */
export const OVERFLOW_GROUP = 'Other'
export const MAX_GROUPS = 6
export const MAX_LABEL = 24

export function emptyLayout(): NavLayout {
  return { pinned: [], groups: [] }
}

export function parseLayout(raw: string | null | undefined): NavLayout {
  if (!raw) return emptyLayout()
  try {
    const v = JSON.parse(raw) as Partial<NavLayout>
    return {
      pinned: Array.isArray(v.pinned) ? v.pinned.filter(x => typeof x === 'string') : [],
      groups: Array.isArray(v.groups)
        ? v.groups
            .filter(g => g && typeof g.label === 'string' && Array.isArray(g.paths))
            .map(g => ({ label: String(g.label).slice(0, MAX_LABEL), paths: g.paths.filter(x => typeof x === 'string') }))
        : [],
    }
  } catch { return emptyLayout() }
}

/**
 * The sidebar a role actually gets.
 *
 * Filtered by what the role may open, so a layout left over from before a tab
 * was revoked cannot show a link that 403s. And — the part that matters more —
 * anything GRANTED but not placed anywhere still appears, in an overflow group.
 * Without that, ticking a new tab would grant access the staff member has no
 * way to reach, which reads as the tick not having worked.
 */
export function resolveNav(grantedPaths: readonly string[], layout: NavLayout, unrestricted = false): ResolvedNav {
  const may = (href: string) =>
    unrestricted ||
    pathAllowed(href, grantedPaths) ||
    ALWAYS_ALLOWED.some(a => a.href === href)

  const byHref = new Map(ALL_TABS.map(t => [t.href, t]))
  for (const a of ALWAYS_ALLOWED) if (!byHref.has(a.href)) byHref.set(a.href, a)

  const placed = new Set<string>()
  const take = (hrefs: readonly string[]): NavLink[] => {
    const out: NavLink[] = []
    for (const href of hrefs) {
      if (placed.has(href)) continue
      const tab = byHref.get(href)
      if (!tab || !may(href)) continue
      placed.add(href)
      out.push(tab)
    }
    return out
  }

  const pinned = take(layout.pinned)
  const groups = layout.groups
    .map(g => ({ label: g.label, links: take(g.paths) }))
    .filter(g => g.links.length > 0)

  // Everything the role holds that the owner has not filed anywhere. Ordered by
  // the catalogue so it reads the same way the rest of the OS does.
  const leftovers = take([
    ...ALWAYS_ALLOWED.map(a => a.href),
    ...ALL_TABS.map(t => t.href).filter(h => grantedPaths.includes(h)),
  ])

  if (leftovers.length > 0) {
    // Always-allowed tabs pin themselves when unplaced: clocking in is the
    // first thing done on a shift and should not be behind a drop-down.
    const alwaysHrefs = new Set(ALWAYS_ALLOWED.map(a => a.href))
    const pinnable = leftovers.filter(l => alwaysHrefs.has(l.href))
    const rest = leftovers.filter(l => !alwaysHrefs.has(l.href))
    pinned.unshift(...pinnable)
    if (rest.length > 0) {
      const existing = groups.find(g => g.label === OVERFLOW_GROUP)
      if (existing) existing.links.push(...rest)
      else groups.push({ label: OVERFLOW_GROUP, links: rest })
    }
  }

  return { pinned, groups }
}

/**
 * Clean a layout coming from the browser.
 *
 * Drops hrefs that are not real tabs and groups that are empty or unnamed, and
 * caps how many groups there can be. A sidebar is not a place to accept
 * arbitrary strings: the labels are rendered, and the hrefs become links.
 */
export function sanitizeLayout(input: NavLayout, grantedPaths: readonly string[]): NavLayout {
  const valid = new Set([...ALL_TABS.map(t => t.href), ...ALWAYS_ALLOWED.map(a => a.href)])
  const granted = (href: string) =>
    valid.has(href) &&
    (grantedPaths.includes(href) || ALWAYS_ALLOWED.some(a => a.href === href))

  const seen = new Set<string>()
  const dedupe = (hrefs: string[]) => hrefs.filter(h => {
    if (!granted(h) || seen.has(h)) return false
    seen.add(h)
    return true
  })

  return {
    pinned: dedupe(input.pinned),
    groups: input.groups
      .map(g => ({ label: g.label.trim().slice(0, MAX_LABEL), paths: dedupe(g.paths) }))
      .filter(g => g.label.length > 0 && g.paths.length > 0)
      .slice(0, MAX_GROUPS),
  }
}
