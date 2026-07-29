// Per-role access model — the single source shared by proxy.ts (the route
// gate), app/api/login (landing), and the Nav (which links to show). Pure data,
// no imports, so it is safe in the edge runtime the proxy runs in.
//
// The principle: each staff member sees only their job. Managers are
// unrestricted; every other role is default-deny — anything not explicitly
// allowed below sends them back to their home screen.

export const STAFF_ROLES = ['FrontDesk', 'Groomer', 'Boarding'] as const

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
  FrontDesk: ['/actions', '/appointments', '/board', '/runsheet', '/rooms', '/pos', '/customers', '/cats', '/memberships', '/incidents'],
  // Groomer: the service board + cat records/assessments. No POS, no customers.
  Groomer: ['/board', '/cats'],
  // Boarding carer: the run sheet + rooms + cat records. No POS, no customers.
  Boarding: ['/runsheet', '/rooms', '/cats'],
}

// Paths any signed-in staff member may reach regardless of role: logout, the
// time clock (everyone clocks in/out), and media upload/serve (clock-in selfies
// + assessment photos post to /api/media/*).
export const STAFF_COMMON_PATHS = ['/api/logout', '/timeclock', '/api/media']

export function roleHome(role: string): string {
  return ROLE_HOME[role] ?? '/board'
}

// Is `pathname` within a staff role's allow-list? (Managers bypass this.)
export function staffCanAccess(role: string, pathname: string): boolean {
  const allowed = [...STAFF_COMMON_PATHS, ...(STAFF_ROLE_PATHS[role] ?? [])]
  return allowed.some(p => pathname === p || pathname.startsWith(p + '/'))
}
