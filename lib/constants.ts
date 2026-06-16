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
