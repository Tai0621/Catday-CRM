export const CUSTOMER_SOURCES = ['GoogleForm', 'WhatsApp', 'WalkIn', 'Referral', 'Other'] as const
export type CustomerSource = typeof CUSTOMER_SOURCES[number]

export const LIFE_STAGES = ['Kitten', 'Adult', 'Senior'] as const
export type LifeStage = typeof LIFE_STAGES[number]

export const GENDERS = ['Male', 'Female'] as const
export type Gender = typeof GENDERS[number]

export const APPOINTMENT_TYPES = ['Grooming', 'Boarding', 'Bath', 'Diagnosis', 'Other'] as const
export type AppointmentType = typeof APPOINTMENT_TYPES[number]

export const APPOINTMENT_STATUSES = ['Scheduled', 'CheckedIn', 'InService', 'QualityCheck', 'Ready', 'Completed', 'NoShow', 'Cancelled'] as const
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number]

// Service-board flow (grooming/bath/diagnosis) — order matters
export const BOARD_FLOW = ['Scheduled', 'CheckedIn', 'InService', 'QualityCheck', 'Ready', 'Completed'] as const
export const BOARD_COLUMN_LABELS: Record<string, string> = {
  Scheduled: 'Waiting', CheckedIn: 'Checked in', InService: 'In service',
  QualityCheck: 'Quality check', Ready: 'Ready for pickup',
}
export const BOARD_ADVANCE_LABELS: Record<string, string> = {
  Scheduled: 'Check in', CheckedIn: 'Start', InService: 'Quality check',
  QualityCheck: 'Mark ready', Ready: 'Picked up',
}
// Each service-board stage gets its own colour so staff read progress at a
// glance without reading labels: waiting=taupe, checked-in=teal, in-service=
// rust (active), quality-check=gold (review), ready=green (go). `color` is the
// solid accent (column header, card top border, advance button); `bg` is the
// soft tint (count pill, card wash).
export const BOARD_STAGE_COLORS: Record<string, { color: string; bg: string }> = {
  Scheduled:    { color: '#8A7A5E', bg: 'rgba(138,122,94,0.14)' },
  CheckedIn:    { color: '#729094', bg: 'rgba(114,144,148,0.16)' },
  InService:    { color: '#B14919', bg: 'rgba(177,73,25,0.13)' },
  QualityCheck: { color: '#B8902B', bg: 'rgba(184,144,43,0.16)' },
  Ready:        { color: '#5F7A3F', bg: 'rgba(95,122,63,0.16)' },
}

// Grooming before/after media, attached to the grooming appointment (the
// per-visit unit) so each transformation stays scoped to one visit.
export const GROOM_MEDIA_TAGS = { before: 'groom-before', after: 'groom-after' } as const
// Appointment types that carry a service board / grooming assessment.
export const GROOMING_APPT_TYPES = ['Grooming', 'Bath', 'Diagnosis'] as const

export const ROOM_TYPES = ['Standard', 'Suite', 'DayStay'] as const
export type RoomType = typeof ROOM_TYPES[number]

export const ROOM_STATUSES = ['Available', 'Occupied', 'Cleaning', 'Maintenance'] as const
export type RoomStatus = typeof ROOM_STATUSES[number]

export const MEMBERSHIP_STATUSES = ['Active', 'Expired', 'Cancelled', 'Paused'] as const
export type MembershipStatus = typeof MEMBERSHIP_STATUSES[number]

// How a member obtains a tier
export const TIER_QUALIFICATIONS = ['Auto', 'Spending', 'Invitation', 'Paid', 'Manual'] as const
export type TierQualification = typeof TIER_QUALIFICATIONS[number]

export const TIER_QUALIFICATION_LABELS: Record<string, string> = {
  Auto: 'Automatic (free)',
  Spending: 'Earned by annual spend',
  Invitation: 'By invitation only',
  Paid: 'Paid subscription',
  Manual: 'Manually assigned',
}

// Physical/digital card style per tier
export const CARD_TYPES = ['Digital', 'Matte', 'Collectible'] as const
export type CardType = typeof CARD_TYPES[number]

// Loyalty / royalty engine — point-earning behaviours (from Cat Day Prive structure)
export const POINTS_REASONS: { reason: string; label: string; points: number }[] = [
  { reason: 'GroomingCompleted', label: 'Completed grooming session', points: 50 },
  { reason: 'GoogleReview', label: 'Google review', points: 100 },
  { reason: 'SocialPost', label: 'Posted & tagged @CatDay', points: 50 },
  { reason: 'Referral', label: 'Referred a new member', points: 200 },
  { reason: 'EventAttendance', label: 'Attended an event', points: 100 },
  { reason: 'BirthdayCelebration', label: 'Birthday celebration', points: 50 },
  { reason: 'EarlyBooking', label: 'Early secured booking', points: 25 },
  { reason: 'MultiCat', label: 'Multi-cat family visit', points: 50 },
  { reason: 'Manual', label: 'Manual adjustment', points: 0 },
  { reason: 'Redemption', label: 'Redeemed a reward', points: 0 },
  { reason: 'Purchase', label: 'Purchase (POS checkout)', points: 0 }, // variable: RM spent × tier multiplier
]

export const POINTS_REASON_LABELS: Record<string, string> = Object.fromEntries(
  POINTS_REASONS.map(r => [r.reason, r.label])
)

// Gold tier threshold (trailing 12-month spend, RM)
export const GOLD_SPEND_THRESHOLD = 3000

// Founder Circle — first N members get a numbered collectible card
export const FOUNDER_CIRCLE_LIMIT = 100

export const REVENUE_CATEGORIES = ['Grooming', 'Boarding', 'Retail', 'Membership', 'Academy', 'Other'] as const
export type RevenueCategory = typeof REVENUE_CATEGORIES[number]

export const INCIDENT_TYPES = ['Safety', 'Complaint'] as const
export type IncidentType = typeof INCIDENT_TYPES[number]

// Dashboard alert windows (days)
export const VACCINATION_ALERT_DAYS = 30

// ── Health & feeding (boarding SOPs S002/S004) ──
// Parasite control is monthly; both are mandatory for boarding — if a cat isn't
// current on check-in, an on-site treatment is auto-charged (owner decision).
export const DEWORM_INTERVAL_DAYS = 30
export const DEFLEA_INTERVAL_DAYS = 30
export const TREATMENT_ALERT_DAYS = 7          // surface the reminder this far ahead of due
export const BOARDING_TREATMENT_CHARGE = 50    // RM, on-site deworm/deflea when not current at boarding

export const DIET_TYPES = ['Commercial', 'Prescription', 'Owner-supplied'] as const
export type DietType = typeof DIET_TYPES[number]

// Meals/day auto-derived from life stage when the cat's mealsPerDay is unset (S002).
export const MEALS_BY_LIFE_STAGE: Record<string, number> = { Kitten: 3, Adult: 2, Senior: 2 }
export const DEFAULT_MEALS_PER_DAY = 2

// ── Action Inbox ──
export const ACTION_TYPES = [
  'OutstandingPayment', 'VipArrival', 'RebookCheckout', 'WinBack',
  'MembershipExpiry', 'VaccinationExpiry', 'GroomingDue', 'Birthday', 'GoldEligible',
  'PrivateClubEligible', 'VipCheckIn', 'LicenseRenewal', 'TreatmentDue', 'HealthConcern',
  'LeaveApproval',
] as const
export type ActionType = typeof ACTION_TYPES[number]

// ── HR · Leave ──
export const LEAVE_TYPES = ['Annual', 'Medical', 'Emergency', 'Unpaid'] as const
export type LeaveType = typeof LEAVE_TYPES[number]
export const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected'] as const

// ── Licenses & Renewals (Administrative) ──
// Compliance items with an expiry: business/health/fire permits, insurance,
// certifications. Each carries its own lead time (a premise licence may need
// 60 days) and surfaces in the Action Inbox that far ahead of its renewal date.
export const LICENSE_CATEGORIES = [
  'Business Licence', 'Health & Safety Permit', 'Fire Safety', 'Signboard Licence',
  'Insurance', 'Certification', 'Tenancy', 'Other',
] as const
export type LicenseCategory = typeof LICENSE_CATEGORIES[number]
export const LICENSE_DEFAULT_REMINDER_DAYS = 30

export const WINBACK_INACTIVE_DAYS = 90       // owner doc: win-back automation trigger
export const BIRTHDAY_LOOKAHEAD_DAYS = 7      // birthday actions surface a week ahead
export const ACTION_DISMISS_WINDOW_DAYS = 30  // dismissed/done actions stay hidden this long
export const ACTION_SNOOZE_DAYS = 7

export const LEAD_TYPES = ['BookingRequest', 'Inquiry', 'Complaint', 'Reschedule', 'Cancellation', 'Other'] as const
export type LeadType = typeof LEAD_TYPES[number]

export const LEAD_STATUSES = ['Pending', 'Confirmed', 'Dismissed'] as const
export type LeadStatus = typeof LEAD_STATUSES[number]

export const ENROLLMENT_STATUSES = ['Pending', 'Active', 'Completed', 'Withdrawn'] as const
export type EnrollmentStatus = typeof ENROLLMENT_STATUSES[number]

// Grooming interval defaults (days)
export const GROOMING_INTERVALS: Record<string, number> = {
  'Persian': 28,
  'Maine Coon': 28,
  'Ragdoll': 35,
  'Siberian': 35,
  'British Shorthair': 42,
  'Scottish Fold': 42,
  'default_longhair': 28,
  'default_shorthair': 42,
  'default': 42,
}

export const GROOMING_REMINDER_WINDOW_DAYS = 7
export const MEMBERSHIP_EXPIRY_ALERT_DAYS = 14

// ── Coat-based rebooking cycles (owner plan: long-hair de-mat/SPA 15-20d, short-hair ~30d) ──
export const COAT_TYPES = ['Short', 'Long'] as const
export type CoatType = typeof COAT_TYPES[number]
export const COAT_CYCLE_DAYS: Record<string, number> = { Long: 18, Short: 30 }

// ── Cat Day Wallet (储值) top-up packages — opening offer ──
export const WALLET_PACKAGES = [
  { pay: 500, bonus: 50 },
  { pay: 1000, bonus: 150 },
  { pay: 3000, bonus: 500 },
] as const
export const WALLET_KINDS = ['TopUp', 'Bonus', 'Spend', 'Adjustment'] as const

// ── Private Club entry (owner plan: RM1000 lifetime spend OR 3+ completed visits) ──
export const PRIVATE_CLUB_TIER = 'Black Circle'
export const PRIVATE_CLUB_SPEND = 1000
export const PRIVATE_CLUB_VISITS = 3

// ── Staff & roles (Manager sees everything; others get the staff view) ──
export const STAFF_ROLES = ['Manager', 'FrontDesk', 'Groomer', 'Boarding'] as const
export type StaffRole = typeof STAFF_ROLES[number]
export const STAFF_ROLE_LABELS: Record<string, string> = {
  Manager: 'Store Manager', FrontDesk: 'Front Desk', Groomer: 'Groomer', Boarding: 'Boarding Care',
}

// ── Service menu categories ──
export const SERVICE_CATEGORIES = ['Grooming', 'Bath', 'Diagnosis', 'Boarding', 'AddOn'] as const

// ── Slot engine: store hours & granularity (manager can tune here) ──
export const OPEN_HOUR = 10
export const CLOSE_HOUR = 19
export const SLOT_STEP_MIN = 30

// ── Payment methods (drives the daily cash-up) ──
export const PAY_METHODS = ['Cash', 'Card', 'QR', 'Wallet'] as const
export type PayMethod = typeof PAY_METHODS[number]

// ── Boarding run-sheet standard tasks (generated daily per occupied room) ──
// Boarding check-in / check-out condition (visual chips for low-literacy staff)
export const ROOM_CONDITIONS = ['Clean & ready', 'Needs cleaning', 'Damage noted'] as const
export const CAT_CONDITIONS = ['Calm', 'Alert', 'Stressed', 'Lethargic', 'Injury / wound'] as const

// Daily health & behaviour log chips (SOP S004). Values marked with a red flag
// in lib/care-log.ts trigger an alert.
export const LOG_APPETITE = ['Ate fully', 'Partial', 'Refused'] as const
export const LOG_STOOL = ['Normal', 'Soft', 'Diarrhea', 'None'] as const
export const LOG_URINE = ['Normal', 'Discolored', 'Low / none'] as const
export const LOG_ENERGY = ['Normal', 'Low', 'Lethargic'] as const
export const LOG_BEHAVIOR = ['Relaxed', 'Playful', 'Shy', 'Hiding', 'Hissing', 'Aggressive', 'Over-grooming'] as const
export const LOG_RESPIRATORY = ['Clear', 'Sneezing', 'Coughing', 'Labored'] as const
export const LOG_SKIN = ['Normal', 'Matted', 'Dry', 'Parasites'] as const
export const LOG_PERIODS = ['AM', 'PM'] as const

export const CARE_TASKS = [
  'Morning feeding',
  'Litter refresh',
  'Playtime & enrichment',
  'Evening feeding',
  'Photo update to owner',
] as const
export const CARE_TASK_MEDICATION = 'Medication / special care'

// ── Groomer assessment (建档) dropdown options — fixed vocabulary keeps records comparable ──
export const ASSESSMENT_OPTIONS = {
  skinCondition: ['Healthy', 'Dry', 'Flaky', 'Oily', 'Irritated'],
  coatCondition: ['Healthy', 'Dry', 'Oily', 'Matted', 'Heavy shedding'],
  earCondition: ['Clean', 'Waxy', 'Needs attention'],
  nailCondition: ['Trimmed', 'Due', 'Overgrown'],
  stressLevel: ['Low', 'Medium', 'High'],
} as const
