// ── M1 · Offer economics ─────────────────────────────────────────────────────
//
// The arithmetic that decides whether an offer is worth sending, kept
// import-free so it can be exercised directly — the same treatment as the
// grounding check, the contrast maths and the photo levels. This is the part a
// silent bug would be most expensive in: a wrong break-even reads as a
// confident number and gets planned against.
//
// One thing deliberately absent: any projection of uptake or revenue. That
// needs a conversion rate nobody has measured, and an invented one would
// produce exactly the kind of authoritative-looking figure this module exists
// to avoid. Break-even needs no such assumption — it is arithmetic on facts.

const r2 = (n: number) => Math.round(n * 100) / 100

export interface DayLoad {
  weekday: string
  groomBooked: number
  groomCapacity: number
  groomUtilisationPct: number
  roomNightsSold: number
  roomNightsAvailable: number
  occupancyPct: number
}

export interface ServiceMargin {
  id: string
  name: string
  category: string
  price: number
  commissionPct: number
  /** Price less commission. The OS does not model per-service consumable cost. */
  contributionRM: number
  contributionPct: number
}

export interface OfferEconomics {
  discountedPrice: number
  contributionPerBookingRM: number
  campaignCostRM: number
  /** Bookings needed before the campaign has paid for its own messages. */
  breakEvenBookings: number | null
  /** True when the targeted days are already busy — discounting them gives money away. */
  cannibalisationRisk: boolean
  targetedUtilisationPct: number
}

/** At or above this a day is not slack, and a discount displaces a full-price booking. */
export const CANNIBALISATION_THRESHOLD_PCT = 70

export function offerEconomics(
  service: ServiceMargin,
  discountPct: number,
  audienceSize: number,
  messageCostRM: number,
  targetedDays: Pick<DayLoad, 'groomUtilisationPct' | 'occupancyPct'>[],
): OfferEconomics {
  const discounted = r2(service.price * (1 - discountPct / 100))
  // Commission is a share of the FULL service price, not the discounted one —
  // the groomer's cut does not shrink because marketing ran a promotion, so
  // costing it off the discounted price would overstate every margin here.
  const contribution = r2(discounted - (service.price * service.commissionPct / 100))
  const campaignCost = r2(audienceSize * messageCostRM)

  const targetedUtilisation = targetedDays.length > 0
    ? Math.round((targetedDays.reduce(
      (s, d) => s + Math.max(d.groomUtilisationPct, d.occupancyPct), 0) / targetedDays.length) * 10) / 10
    : 0

  return {
    discountedPrice: discounted,
    contributionPerBookingRM: contribution,
    campaignCostRM: campaignCost,
    // Null rather than Infinity when a booking contributes nothing: there is no
    // number of them that pays for the campaign, and saying so is the answer.
    breakEvenBookings: contribution > 0 ? Math.ceil(campaignCost / contribution) : null,
    cannibalisationRisk: targetedUtilisation >= CANNIBALISATION_THRESHOLD_PCT,
    targetedUtilisationPct: targetedUtilisation,
  }
}
