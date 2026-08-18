import type { ActionType } from './constants'

/**
 * Business segments — one colour per operating area, used consistently across
 * nav, the Action Inbox, dashboard and appointment badges so staff can read
 * "what part of the business is this?" at a glance.
 */
export type SegmentKey = 'grooming' | 'boarding' | 'membership' | 'community' | 'business'

export interface Segment {
  key: SegmentKey
  label: string
  color: string // strong accent — dots, left borders
  text: string  // readable on light backgrounds
  bg: string    // soft chip background
}

export const SEGMENTS: Record<SegmentKey, Segment> = {
  grooming:   { key: 'grooming',   label: 'Grooming & Care',     color: '#B14919', text: '#B14919',           bg: 'rgba(177,73,25,0.13)' },
  boarding:   { key: 'boarding',   label: 'Boarding & Hotel',    color: '#729094', text: '#4a666a',           bg: 'rgba(114,144,148,0.18)' },
  membership: { key: 'membership', label: 'Membership & Wallet', color: '#B8902B', text: '#8a6c00',           bg: 'rgba(231,206,122,0.35)' },
  community:  { key: 'community',  label: 'Community & Growth',  color: '#7A8A4F', text: '#5c6b3c',           bg: 'rgba(122,138,79,0.16)' },
  business:   { key: 'business',   label: 'Business & Finance',  color: '#2D1907', text: 'rgba(45,25,7,0.75)', bg: 'rgba(45,25,7,0.09)' },
}

export const SEGMENT_LIST = Object.values(SEGMENTS)

/** Which segment each Action Inbox rule belongs to. */
export const ACTION_SEGMENT: Record<ActionType, SegmentKey> = {
  OutstandingPayment:  'business',
  VipArrival:          'membership',
  RebookCheckout:      'boarding',
  WinBack:             'community',
  MembershipExpiry:    'membership',
  VaccinationExpiry:   'grooming',
  GroomingDue:         'grooming',
  Birthday:            'community',
  GoldEligible:        'membership',
  PrivateClubEligible: 'membership',
  VipCheckIn:          'membership',
  LicenseRenewal:      'business',
  TreatmentDue:        'grooming',
  HealthConcern:       'boarding',
  LeaveApproval:       'business',
  ApplicationReview:   'business',
  LowStock:            'business',
  AcademyFollowUp:     'community',
  CatReservation:      'business',
  CatSaleReady:        'business',
}

/** Which segment each appointment type belongs to. */
export const APPOINTMENT_SEGMENT: Record<string, SegmentKey> = {
  Grooming:  'grooming',
  Bath:      'grooming',
  Diagnosis: 'grooming',
  Boarding:  'boarding',
  Other:     'business',
}

export function segmentOf(key: SegmentKey): Segment {
  return SEGMENTS[key]
}

export function apptTypeStyle(type: string): { background: string; color: string } {
  const seg = SEGMENTS[APPOINTMENT_SEGMENT[type] ?? 'business']
  return { background: seg.bg, color: seg.text }
}
