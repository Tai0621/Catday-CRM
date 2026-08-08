import type { Presence } from './presence'

// ── M6 · Structured data ─────────────────────────────────────────────────────
//
// LocalBusiness + Service, generated from the tenant's own configuration so a
// second client gets correct markup without anyone editing JSON.
//
// aggregateRating is DELIBERATELY ABSENT. It is the single most valuable rich
// snippet on this page and we could emit one — M4 knows how many customers said
// their visit went well. But that is a thumbs-up, not a star rating, and
// presenting it as one would be inventing a metric customers never gave and
// Google's own guidelines forbid. The page shows the honest sentiment summary
// instead and links to the real reviews. Do not add it later without real,
// customer-submitted ratings behind it.

const WEEKDAY_CODE: Record<string, string> = {
  monday: 'Mo', tuesday: 'Tu', wednesday: 'We', thursday: 'Th',
  friday: 'Fr', saturday: 'Sa', sunday: 'Su',
}
const ALL = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:00`

export function localBusinessSchema(p: Presence, url: string): Record<string, unknown> {
  const { config, services, hours } = p
  const closed = new Set(hours.closedDays.map(d => WEEKDAY_CODE[d.toLowerCase()]).filter(Boolean))
  const open = ALL.filter(d => !closed.has(d))

  const prices = services.map(s => s.price).filter(v => v > 0)
  const priceRange = prices.length > 0
    ? `${config.currency.symbol}${Math.min(...prices)}–${config.currency.symbol}${Math.max(...prices)}`
    : undefined

  return prune({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: config.business.name,
    description: config.publicPage.about || config.business.tagline,
    url,
    telephone: config.business.phone || undefined,
    email: config.business.email || undefined,
    address: config.business.address
      ? { '@type': 'PostalAddress', streetAddress: config.business.address }
      : undefined,
    priceRange,
    currenciesAccepted: config.currency.code,
    openingHoursSpecification: open.length > 0
      ? [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: open.map(d => `https://schema.org/${DAY_URI[d]}`),
        opens: hh(hours.openHour),
        closes: hh(hours.closeHour),
      }]
      : undefined,
    hasOfferCatalog: services.length > 0
      ? {
        '@type': 'OfferCatalog',
        name: `${config.business.name} services`,
        itemListElement: services.map(s => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: s.name,
            category: s.category,
            provider: { '@type': 'LocalBusiness', name: config.business.name },
          },
          price: s.price,
          priceCurrency: config.currency.code,
        })),
      }
      : undefined,
  })
}

const DAY_URI: Record<string, string> = {
  Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday',
  Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday',
}

/** Drop undefined so the emitted JSON-LD has no empty keys for a validator to complain about. */
function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}
