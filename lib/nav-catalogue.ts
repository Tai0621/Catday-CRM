// The catalogue of everything the OS can show in its navigation.
//
// One source, three readers: the Nav renders from it, the role editor lists
// from it, and access control checks against it. When those three disagree the
// failure is invisible in the worst way — a tab the owner ticked that does not
// appear, or worse, a tab they un-ticked that still opens.
//
// Pure data with no imports so it is safe in the edge runtime the proxy uses
// and in a client component.

export interface NavLink { href: string; label: string; icon: string }
export interface NavGroup { sub?: string; subColor?: string; links: NavLink[] }
export interface NavSegment { key: string; header: string; color: string; groups: NavGroup[] }

/** The owner's daily spine — not tied to one segment. */
export const PINNED: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/actions', label: 'Action Inbox', icon: 'inbox' },
]

/**
 * AI is one place rather than scattered through the segments.
 *
 * Header and colour live here, not in the Nav and the role editor separately —
 * those had already drifted into two hardcoded copies of the same word, which
 * is how a section ends up named one thing in the sidebar and another in the
 * screen that grants access to it.
 *
 * The exports keep the AI_ prefix because that is what the section IS;
 * "Intelligence" is what the owner reads.
 */
export const AI_SECTION = { key: 'ai', header: 'Intelligence', color: '#98A86B' } as const

export const AI_LINKS: NavLink[] = [
  { href: '/ai', label: 'Overview', icon: 'ai' },
  { href: '/ask', label: 'Assistant', icon: 'ai' },
  { href: '/brief', label: 'Morning Brief', icon: 'ai' },
  { href: '/reports', label: 'Monthly Reports', icon: 'report' },
]

/** The six business segments — the OS map. Colours match lib/segments.ts. */
export const SEGMENTS: NavSegment[] = [
  {
    key: 'ops', header: 'Operations & Sales', color: '#C86A3C',
    groups: [
      { sub: 'Grooming', subColor: '#C86A3C', links: [
        { href: '/board', label: 'Service Board', icon: 'board' },
        { href: '/services', label: 'Service Menu', icon: 'scissors' },
      ] },
      { sub: 'Boarding', subColor: '#729094', links: [
        { href: '/runsheet', label: 'Run Sheet', icon: 'runsheet' },
        { href: '/rooms/calendar', label: 'Room Calendar', icon: 'calendar' },
        { href: '/rooms', label: 'Rooms', icon: 'rooms' },
      ] },
      { sub: 'Sales', subColor: '#ECDBB6', links: [
        { href: '/appointments', label: 'Appointments', icon: 'clock' },
        { href: '/requests', label: 'Booking Requests', icon: 'chat' },
        { href: '/pos', label: 'POS Checkout', icon: 'pos' },
        { href: '/products', label: 'Products', icon: 'box' },
        { href: '/cashup', label: 'Cash-up', icon: 'wallet' },
      ] },
    ],
  },
  {
    key: 'hr', header: 'Human Resource', color: '#729094',
    groups: [{ links: [
      { href: '/hr/attendance', label: 'Attendance', icon: 'clock' },
      { href: '/hr/leave', label: 'Leave', icon: 'calendar' },
      { href: '/hr/commission', label: 'Commission', icon: 'wallet' },
      { href: '/hr/applications', label: 'Applications', icon: 'staff' },
      { href: '/hr/roles', label: 'Roles & Access', icon: 'staff' },
      { href: '/staff', label: 'Staff & PINs', icon: 'staff' },
    ] }],
  },
  {
    key: 'finance', header: 'Finance', color: '#ECDBB6',
    groups: [
      { sub: '3-Statement', subColor: '#B8902B', links: [
        { href: '/finance/income-statement', label: 'Income Statement', icon: 'report' },
        { href: '/finance/balance-sheet', label: 'Balance Sheet', icon: 'scale' },
        { href: '/finance/cash-flow', label: 'Cash Flow', icon: 'trend' },
      ] },
      { sub: 'Records & Planning', subColor: '#729094', links: [
        { href: '/finance/expenses', label: 'Expenses', icon: 'receipt' },
        { href: '/finance/records', label: 'Records', icon: 'report' },
        { href: '/finance/aging', label: 'Receivables & Payables', icon: 'wallet' },
        { href: '/revenue', label: 'Revenue', icon: 'bars' },
        { href: '/plan', label: 'Financial Plan', icon: 'compass' },
      ] },
    ],
  },
  {
    key: 'crm', header: 'Customers · CRM', color: '#98A86B',
    groups: [{ links: [
      { href: '/customers', label: 'Customers', icon: 'customers' },
      { href: '/cats', label: 'Cats', icon: 'cat' },
      { href: '/memberships', label: 'Memberships', icon: 'star' },
      { href: '/whatsapp', label: 'WhatsApp', icon: 'chat' },
      { href: '/incidents', label: 'Incidents', icon: 'alert' },
    ] }],
  },
  {
    key: 'marketing', header: 'Marketing', color: '#E7CE7A',
    groups: [{ links: [
      { href: '/academy', label: 'Academy', icon: 'cap' },
      { href: '/marketing/campaigns', label: 'Campaigns', icon: 'trend' },
      { href: '/marketing/groups', label: 'Customer Groups', icon: 'customers' },
      { href: '/marketing/content', label: 'Content Studio', icon: 'cat' },
      { href: '/marketing/reviews', label: 'Reviews', icon: 'star' },
      { href: '/marketing/referrals', label: 'Referrals', icon: 'compass' },
      { href: '/admin/variants', label: 'Message Variants', icon: 'chat' },
    ] }],
  },
  {
    key: 'admin', header: 'Administrative', color: '#B8902B',
    groups: [
      { sub: 'Records', subColor: '#B8902B', links: [
        { href: '/admin/assets', label: 'Asset Register', icon: 'asset' },
        { href: '/admin/licenses', label: 'Licenses & Renewals', icon: 'license' },
        { href: '/admin/audit', label: 'Audit Log', icon: 'audit' },
      ] },
      { sub: 'Configuration', subColor: '#B8902B', links: [
        { href: '/admin/settings', label: 'Business Settings', icon: 'settings' },
        { href: '/admin/branding', label: 'Brand Colours', icon: 'star' },
        { href: '/admin/onboarding', label: 'Set Up Business', icon: 'compass' },
      ] },
    ],
  },
]

/**
 * Reachable by any signed-in staff member regardless of role.
 *
 * Deliberately NOT editable. Everyone clocks in and books their own leave, and
 * media upload backs the clock-in selfie and assessment photos — a role with
 * those switched off could not start a shift, which looks like a broken app
 * rather than a permission someone chose.
 */
export const ALWAYS_ALLOWED: NavLink[] = [
  { href: '/timeclock', label: 'Clock In / Out', icon: 'clock' },
  { href: '/leave', label: 'My Leave', icon: 'calendar' },
]
export const ALWAYS_ALLOWED_PATHS = ['/api/logout', '/api/media', ...ALWAYS_ALLOWED.map(l => l.href)]

/** Every assignable tab, flattened — the menu the role editor offers. */
export const ALL_TABS: NavLink[] = [
  ...PINNED,
  ...AI_LINKS,
  ...SEGMENTS.flatMap(s => s.groups.flatMap(g => g.links)),
]

const BY_HREF = new Map(ALL_TABS.map(t => [t.href, t]))
export function tabByHref(href: string): NavLink | undefined { return BY_HREF.get(href) }

/** Which segment a tab belongs to, for grouping the role editor. */
export function segmentOf(href: string): string {
  if (PINNED.some(l => l.href === href)) return 'pinned'
  if (AI_LINKS.some(l => l.href === href)) return 'ai'
  for (const s of SEGMENTS) if (s.groups.some(g => g.links.some(l => l.href === href))) return s.key
  return 'other'
}

/**
 * Does `pathname` fall under one of `paths`?
 *
 * Prefix matching with a boundary, so `/rooms` grants `/rooms/calendar` and
 * `/rooms/abc` but NOT `/roomservice`. Getting that wrong is how an allow-list
 * quietly grants a page nobody ticked.
 */
export function pathAllowed(pathname: string, paths: readonly string[]): boolean {
  return paths.some(p => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))
}
