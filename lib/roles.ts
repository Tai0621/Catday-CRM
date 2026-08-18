// Per-role access model — the single source shared by proxy.ts (the route
// gate), app/api/login (landing), and the Nav (which links to show). Pure data,
// no imports, so it is safe in the edge runtime the proxy runs in.
//
// The principle: each staff member sees only their job. Managers are
// unrestricted; every other role is default-deny — anything not explicitly
// allowed below sends them back to their home screen.

export const STAFF_ROLES = ['FrontDesk', 'Groomer', 'Boarding'] as const

/**
 * Manager-only, whatever a role says.
 *
 * A code-level floor, deliberately NOT owner-editable: these carry pricing,
 * payroll, the books and the marketing spend. It is also a real trap for the
 * allow-list — `/memberships` is a reasonable tab for reception, but tier
 * PRICING sits underneath it at `/memberships/tiers`, so prefix-matching an
 * allowed tab would hand it over. Enforced for pages in app/layout.tsx and for
 * API routes in proxy.ts.
 */
export const MANAGER_ONLY_PATHS = [
  '/revenue', '/plan', '/academy', '/ask', '/api/ask', '/whatsapp', '/brief', '/reports',
  // `/inventory` covers both halves — retail stock and the cat inventory. Cost
  // price, margin and acquisition cost all sit under it, so it stays a floor
  // rather than something a role can be granted piecemeal.
  '/staff', '/services', '/cashup', '/memberships/tiers', '/finance', '/admin', '/hr', '/inventory',
  '/api/customers', '/marketing',
]

export function isManagerOnly(pathname: string): boolean {
  return MANAGER_ONLY_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

// Where each role lands after login, and where a disallowed page bounces them.
export const ROLE_HOME: Record<string, string> = {
  Manager: '/',
  FrontDesk: '/actions',
  Groomer: '/board',
  Boarding: '/runsheet',
}

// Route prefixes each staff role may open (in addition to the manager-only
// denylist in proxy.ts, which still blocks everyone who isn't a manager).
export const STAFF_ROLE_PATHS: Record<string, string[]> = {
  // Reception: books, coordinates check-in/out, takes payment, manages records.
  FrontDesk: ['/actions', '/appointments', '/board', '/runsheet', '/rooms', '/pos', '/customers', '/cats', '/memberships', '/incidents', '/requests'],
  // Groomer: the service board + cat records/assessments. No POS, no customers.
  Groomer: ['/board', '/cats'],
  // Boarding carer: the run sheet + rooms + cat records. No POS, no customers.
  Boarding: ['/runsheet', '/rooms', '/cats'],
}

// Paths any signed-in staff member may reach regardless of role: logout, the
// time clock (everyone clocks in/out), and media upload/serve (clock-in selfies
// + assessment photos post to /api/media/*).
export const STAFF_COMMON_PATHS = ['/api/logout', '/timeclock', '/leave', '/api/media']

export function roleHome(role: string): string {
  return ROLE_HOME[role] ?? '/board'
}

// Is `pathname` within a staff role's allow-list? (Managers bypass this.)
export function staffCanAccess(role: string, pathname: string): boolean {
  const allowed = [...STAFF_COMMON_PATHS, ...(STAFF_ROLE_PATHS[role] ?? [])]
  return allowed.some(p => pathname === p || pathname.startsWith(p + '/'))
}
