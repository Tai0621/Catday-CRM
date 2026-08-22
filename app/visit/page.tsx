import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { buildPresence, countView } from '@/lib/public/presence'
import { localBusinessSchema } from '@/lib/public/schema'
import { isProduction } from '@/lib/environment'
import { publicBaseUrl } from '@/lib/public/url'

// M6 · The public presence page.
//
// The only page in the OS a stranger can open (see proxy PUBLIC_PATHS), and the
// only one a search engine ever sees. It renders entirely from the tenant's own
// config and catalogue, so it white-labels with no code change.
//
// 404s when the tenant has not published it. A public page nobody asked for is
// worse than none: it would put a half-configured business on the open web
// under its real name.

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await buildPresence()
  if (!config.publicPage.enabled) return {}
  const title = `${config.business.name}${config.business.tagline ? ` — ${config.business.tagline}` : ''}`
  const description = config.publicPage.about
    || `${config.business.name}. ${config.business.tagline}`.trim()

  return {
    title,
    description: description.slice(0, 300),
    alternates: { canonical: `${await publicBaseUrl()}/visit` },
    openGraph: { title, description: description.slice(0, 300), type: 'website' },
    // The demo runs a real-looking business on a public URL. Indexing it would
    // put it in the same results as the client it is imitating.
    ...(isProduction() ? {} : { robots: { index: false, follow: false } }),
  }
}

export default async function VisitPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams
  const presence = await buildPresence()
  const { config, services, reviews, hours, rooms } = presence
  if (!config.publicPage.enabled) notFound()

  const h = await headers()
  await countView(h.get('user-agent'), config.timezone)

  const url = `${await publicBaseUrl()}/visit`
  const money = (n: number) => `${config.currency.symbol} ${n.toLocaleString(config.currency.locale, { maximumFractionDigits: 0 })}`
  const hour = (n: number) => `${((n + 11) % 12) + 1}${n >= 12 ? 'pm' : 'am'}`
  const accent = config.brand.primary
  const ink = config.brand.ink

  return (
    <div className="min-h-screen" style={{ background: '#F2EDE0', color: ink }}>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema(presence, url)) }} />

      <main className="max-w-3xl mx-auto px-5 py-12 space-y-10">
        <header className="text-center space-y-2">
          {config.brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.brand.logoUrl} alt="" width={72} height={72} className="mx-auto" style={{ objectFit: 'contain' }} />
          )}
          <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-brand)' }}>{config.business.name}</h1>
          {config.publicPage.headline
            ? <p className="text-lg" style={{ color: accent }}>{config.publicPage.headline}</p>
            : config.business.tagline && <p className="text-lg" style={{ color: accent }}>{config.business.tagline}</p>}
          {config.publicPage.about && (
            <p className="text-sm max-w-xl mx-auto" style={{ color: 'rgba(45,25,7,0.7)' }}>{config.publicPage.about}</p>
          )}
        </header>

        {services.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold">Services</h2>
            <div className="cd-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="cd-tbody">
                    {services.map(s => (
                      <tr key={s.name}>
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap" style={{ color: 'rgba(45,25,7,0.55)' }}>
                          {s.durationMin} min
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">{money(s.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {rooms > 0 && (
              <p className="text-xs" style={{ color: 'rgba(45,25,7,0.55)' }}>
                {rooms} boarding {rooms === 1 ? 'room' : 'rooms'} available.
              </p>
            )}
          </section>
        )}

        <section className="grid sm:grid-cols-2 gap-4">
          <div className="cd-card p-4 space-y-1">
            <h2 className="font-semibold">Opening hours</h2>
            <p className="text-sm">{hour(hours.openHour)} – {hour(hours.closeHour)}</p>
            {hours.closedDays.length > 0 && (
              <p className="text-sm" style={{ color: 'rgba(45,25,7,0.55)' }}>Closed {hours.closedDays.join(', ')}</p>
            )}
          </div>
          <div className="cd-card p-4 space-y-1">
            <h2 className="font-semibold">Find us</h2>
            {config.business.address && <p className="text-sm">{config.business.address}</p>}
            {config.business.phone && (
              <p className="text-sm"><a href={`tel:${config.business.phone}`} style={{ color: accent }}>{config.business.phone}</a></p>
            )}
            {config.publicPage.mapUrl && (
              <a href={config.publicPage.mapUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm" style={{ color: accent }}>Open in maps →</a>
            )}
          </div>
        </section>

        {/* Sentiment, not stars — see lib/public/schema.ts for why this is not
            dressed up as a rating. */}
        {reviews.positivePct != null && (
          <section className="cd-card p-4 text-center space-y-1">
            <p className="text-2xl font-bold" style={{ color: accent }}>{reviews.positivePct}%</p>
            <p className="text-sm">
              of {reviews.answered} customers asked after their visit said it went well
            </p>
            {reviews.url && (
              <a href={reviews.url} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ color: accent }}>
                Read our reviews →
              </a>
            )}
          </section>
        )}

        <section id="book" className="space-y-3">
          <h2 className="text-xl font-bold">Request a booking</h2>
          {sent ? (
            <div className="cd-card p-8 text-center space-y-2">
              <div className="text-3xl">🐾</div>
              <h3 className="font-bold text-lg">Thank you — we have your request.</h3>
              <p className="text-sm" style={{ color: 'rgba(45,25,7,0.7)' }}>
                Someone will be in touch to confirm a time. This is a request, not a confirmed booking.
              </p>
            </div>
          ) : (
            <form action="/api/visit" method="POST" className="cd-card p-5 space-y-4">
              {error && (
                <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
                  style={{ background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
                  Please give at least your name and a phone number we can reach you on.
                </div>
              )}
              {/* Honeypot — hidden from people, catches bots (same pattern as /careers) */}
              <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="cd-label">Your name *</label>
                  <input name="name" required maxLength={80} className="cd-input" />
                </div>
                <div>
                  <label className="cd-label">Phone *</label>
                  <input name="phone" required maxLength={40} className="cd-input" placeholder="e.g. 012-345 6789" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="cd-label">Cat&apos;s name</label>
                  <input name="catName" maxLength={60} className="cd-input" />
                </div>
                <div>
                  <label className="cd-label">What for?</label>
                  <select name="serviceName" className="cd-input" defaultValue="">
                    <option value="">— select —</option>
                    {services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="cd-label">Preferred date</label>
                  <input name="preferredDate" type="date" className="cd-input" />
                </div>
                <div>
                  <label className="cd-label">Email</label>
                  <input name="email" type="email" maxLength={120} className="cd-input" />
                </div>
              </div>
              <div>
                <label className="cd-label">Anything we should know?</label>
                <textarea name="notes" rows={2} maxLength={600} className="cd-input" />
              </div>
              <button type="submit" className="cd-btn" style={{ background: accent }}>Send request</button>
              <p className="text-xs" style={{ color: 'rgba(45,25,7,0.55)' }}>
                We use these details only to contact you about this request. See our{' '}
                <a href="/privacy" style={{ color: accent }}>privacy notice</a>.
              </p>
            </form>
          )}
        </section>

        <footer className="text-center text-xs pt-6" style={{ color: 'rgba(45,25,7,0.45)' }}>
          {config.business.legalName || config.business.name}
          {config.business.regNo ? ` · ${config.business.regNo}` : ''}
        </footer>
      </main>
    </div>
  )
}
