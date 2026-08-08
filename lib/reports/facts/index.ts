import { operationsFacts } from './operations'
import { hrFacts } from './hr'
import { financeFacts } from './finance'
import { crmFacts } from './crm'
import { marketingFacts } from './marketing'
import { adminFacts } from './admin'
import type { SegmentKey } from '../../segments'

// The six business segments, in the owner's own order (matching Nav.tsx).
export const DEPARTMENTS = [
  {
    key: 'operations', label: 'Operations & Sales', segment: 'grooming' as SegmentKey,
    brief: 'appointments, no-shows, room occupancy and stay length',
    links: ['/appointments', '/rooms', '/runsheet', '/board'],
    build: operationsFacts,
  },
  {
    key: 'hr', label: 'Human Resource', segment: 'business' as SegmentKey,
    brief: 'hours worked, leave, commission earned and hiring',
    links: ['/hr/attendance', '/hr/leave', '/hr/commission', '/hr/applications', '/staff'],
    build: hrFacts,
  },
  {
    key: 'finance', label: 'Finance', segment: 'business' as SegmentKey,
    brief: 'revenue, costs, margin, plan variance and what is owed either way',
    links: ['/finance/income-statement', '/finance/expenses', '/finance/aging', '/revenue', '/plan'],
    build: financeFacts,
  },
  {
    key: 'crm', label: 'Customers · CRM', segment: 'membership' as SegmentKey,
    brief: 'who joined, who came back, and who moved between segments',
    links: ['/customers', '/memberships', '/incidents', '/actions'],
    build: crmFacts,
  },
  {
    key: 'marketing', label: 'Marketing', segment: 'community' as SegmentKey,
    brief: 'outreach volume, review funnel, referrals and attributed revenue',
    links: ['/marketing/groups', '/marketing/reviews', '/marketing/referrals', '/admin/variants', '/actions'],
    build: marketingFacts,
  },
  {
    key: 'admin', label: 'Administrative', segment: 'business' as SegmentKey,
    brief: 'licences, assets, the audit trail and data-protection actions',
    links: ['/admin/licenses', '/admin/assets', '/admin/audit', '/privacy'],
    build: adminFacts,
  },
] as const

export type DepartmentKey = (typeof DEPARTMENTS)[number]['key']
export const DEPARTMENT_KEYS = DEPARTMENTS.map(d => d.key) as readonly DepartmentKey[]
export const departmentByKey = (key: string) => DEPARTMENTS.find(d => d.key === key)

export async function buildDepartmentFacts(key: DepartmentKey, month: string): Promise<unknown> {
  const dept = departmentByKey(key)
  if (!dept) throw new Error(`Unknown department ${key}`)
  return dept.build(month)
}
