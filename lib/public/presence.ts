import { db } from '../db'
import { getConfig, type AppConfig } from '../config'
import { zonedDayKey } from '../timezone'

// ── M6 · What the public page shows ──────────────────────────────────────────
//
// Everything is drawn from the tenant's own configuration and catalogue, so the
// page white-labels for free — a second client's page is their name, their
// colours, their prices, with no code change.
//
// The review summary is the one place where the honest answer is smaller than
// the tempting one. M4 records a thumbs-up/down before routing a happy customer
// to a public review site; it does NOT store written testimonials or stars. So
// the page reports what we actually know — how many people were asked and how
// many said the visit went well — and links out for the real reviews. Inventing
// testimonials, or dressing sentiment up as an average rating, would be a lie
// that ranks.

const DAY = 24 * 60 * 60 * 1000

export interface PresenceService {
  name: string
  category: string
  durationMin: number
  price: number
}

export interface Presence {
  config: AppConfig
  services: PresenceService[]
  reviews: { asked: number; answered: number; positive: number; positivePct: number | null; url: string }
  hours: { openHour: number; closeHour: number; closedDays: string[] }
  rooms: number
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export async function buildPresence(): Promise<Presence> {
  const config = await getConfig()
  const since = new Date(Date.now() - 365 * DAY)

  const [services, rooms, reviews] = await Promise.all([
    db.service.findMany({
      where: { active: true },
      select: { name: true, category: true, durationMin: true, price: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    db.room.count({ where: { isActive: true } }),
    db.reviewRequest.findMany({
      where: { sentAt: { gte: since } },
      select: { respondedAt: true, sentiment: true },
    }),
  ])

  const answered = reviews.filter(r => r.respondedAt).length
  const positive = reviews.filter(r => r.sentiment === 'Positive').length

  const closedDays = config.publicPage.closedDays
    .split(',').map(s => s.trim())
    .filter(d => WEEKDAYS.some(w => w.toLowerCase() === d.toLowerCase()))

  return {
    config,
    services,
    rooms,
    reviews: {
      asked: reviews.length,
      answered,
      positive,
      // Below a handful of responses a percentage is theatre, not evidence.
      positivePct: answered >= 5 ? Math.round((positive / answered) * 100) : null,
      url: config.marketing.reviewUrl,
    },
    hours: { openHour: config.ops.openHour, closeHour: config.ops.closeHour, closedDays },
  }
}

/**
 * Count a page view.
 *
 * Bots are dropped by user agent first. This does not pretend to be analytics —
 * it exists so the funnel has a denominator, and the page says as much.
 */
// Two families: declared crawlers, and bare runtime/tool identifiers. The
// second matters more than it looks — Node's own fetch sends a user agent of
// exactly "node", so without \bnode\b every server-to-server request in the
// estate would land in the funnel as a visitor.
const BOT = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'bingpreview', 'facebookexternalhit',
  'headless', 'monitor', 'uptime', 'preview', 'fetcher',
  '\\bcurl\\b', '\\bwget\\b', '\\bnode\\b', '\\bjava\\b', '\\bgo-http-client\\b',
  '\\bokhttp\\b', '\\bpostman\\b', '\\binsomnia\\b', 'python-requests', 'axios',
].join('|'), 'i')

export async function countView(userAgent: string | null, timezone: string): Promise<boolean> {
  if (!userAgent || BOT.test(userAgent)) return false
  const date = zonedDayKey(new Date(), timezone)
  await db.publicPageView.upsert({
    where: { date },
    create: { date, views: 1 },
    update: { views: { increment: 1 } },
  })
  return true
}

export async function countRequest(timezone: string): Promise<void> {
  const date = zonedDayKey(new Date(), timezone)
  await db.publicPageView.upsert({
    where: { date },
    create: { date, requests: 1 },
    update: { requests: { increment: 1 } },
  })
}

export interface Funnel {
  days: number
  views: number
  requests: number
  booked: number
  completed: number
  viewToRequestPct: number | null
  requestToBookedPct: number | null
}

/** view → request → booked → showed. The first real top-of-funnel the OS has had. */
export async function buildFunnel(days = 30): Promise<Funnel> {
  const since = new Date(Date.now() - days * DAY)
  const sinceKey = since.toISOString().slice(0, 10)

  const [counters, requests] = await Promise.all([
    db.publicPageView.findMany({ where: { date: { gte: sinceKey } }, select: { views: true, requests: true } }),
    db.bookingRequest.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, appointmentId: true },
    }),
  ])

  const views = counters.reduce((s, c) => s + c.views, 0)
  const booked = requests.filter(r => r.appointmentId).length
  const appointmentIds = requests.map(r => r.appointmentId).filter((id): id is string => !!id)
  const completed = appointmentIds.length > 0
    ? await db.appointment.count({ where: { id: { in: appointmentIds }, status: 'Completed' } })
    : 0

  return {
    days,
    views,
    requests: requests.length,
    booked,
    completed,
    viewToRequestPct: views > 0 ? Math.round((requests.length / views) * 1000) / 10 : null,
    requestToBookedPct: requests.length > 0 ? Math.round((booked / requests.length) * 1000) / 10 : null,
  }
}
