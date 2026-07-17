// Single source of truth for "what does this appointment owe at the POS".
// Used by the POS loader so a finished grooming/boarding visit always surfaces
// with the right amount — no re-typing, no silent drop when price was blank.

const DAY = 24 * 60 * 60 * 1000

export function boardingNights(scheduledAt: Date, endsAt: Date | null, now: Date): number {
  const end = endsAt ?? now
  return Math.max(1, Math.ceil((end.getTime() - scheduledAt.getTime()) / DAY))
}

export type ApptChargeInput = {
  type: string
  price: number | null
  depositRM: number | null
  scheduledAt: Date
  endsAt: Date | null
  service: { price: number; category: string } | null
}

export type ApptCharge = {
  gross: number          // full price of the visit before any deposit
  deposit: number        // already-paid booking deposit, credited at checkout
  net: number            // what's actually collected now (gross − deposit, ≥ 0)
  needsPrice: boolean    // price couldn't be determined → cashier confirms it
  nights?: number        // boarding only, for the label
}

export function resolveApptCharge(a: ApptChargeInput, now: Date): ApptCharge {
  const deposit = a.depositRM ?? 0
  let price: number | null = a.price ?? null
  let nights: number | undefined

  if (a.type === 'Boarding') {
    nights = boardingNights(a.scheduledAt, a.endsAt, now)
    // Trust a stored price; otherwise derive from the nightly rate × nights stayed
    if (price == null && a.service) price = a.service.price * nights
  } else if (price == null && a.service) {
    price = a.service.price
  }

  const needsPrice = price == null
  const gross = Math.round((price ?? 0) * 100) / 100
  const net = Math.max(0, Math.round((gross - deposit) * 100) / 100)
  return { gross, deposit, net, needsPrice, nights }
}
