export const CUSTOMER_SOURCES = ['GoogleForm', 'WhatsApp', 'WalkIn', 'Referral', 'Other'] as const
export type CustomerSource = typeof CUSTOMER_SOURCES[number]

export const LIFE_STAGES = ['Kitten', 'Adult', 'Senior'] as const
export type LifeStage = typeof LIFE_STAGES[number]

export const GENDERS = ['Male', 'Female'] as const
export type Gender = typeof GENDERS[number]

export const APPOINTMENT_TYPES = ['Grooming', 'Boarding', 'Bath', 'Other'] as const
export type AppointmentType = typeof APPOINTMENT_TYPES[number]

export const APPOINTMENT_STATUSES = ['Scheduled', 'CheckedIn', 'Completed', 'NoShow', 'Cancelled'] as const
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number]

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
]

export const POINTS_REASON_LABELS: Record<string, string> = Object.fromEntries(
  POINTS_REASONS.map(r => [r.reason, r.label])
)

// Gold tier threshold (trailing 12-month spend, RM)
export const GOLD_SPEND_THRESHOLD = 3000

// Founder Circle — first N members get a numbered collectible card
export const FOUNDER_CIRCLE_LIMIT = 100

export const REVENUE_CATEGORIES = ['Grooming', 'Boarding', 'Membership', 'Academy', 'Other'] as const
export type RevenueCategory = typeof REVENUE_CATEGORIES[number]

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
