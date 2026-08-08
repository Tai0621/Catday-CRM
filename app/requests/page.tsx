import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { buildFunnel } from '@/lib/public/presence'
import { whatsappUrl } from '@/lib/phone'
import { SEGMENTS } from '@/lib/segments'
import { setRequestStatus, linkAppointment } from './actions'
import Link from 'next/link'

// M6 · Enquiries from the public page, and the funnel they feed.
//
// A request is a lead, not a booking. Turning one into an appointment goes
// through the normal booking screen — pricing, slots and room capacity all
// assume that path — and the id is pasted back here so the funnel can join
// view → request → booked → showed.
export default async function RequestsPage() {
  await requireAuth()
  const [requests, funnel, config] = await Promise.all([
    db.bookingRequest.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100 }),
    buildFunnel(30),
    getConfig(),
  ])

  const seg = SEGMENTS.grooming
  const open = requests.filter(r => r.status === 'New')

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Booking requests
          {open.length > 0 && (
            <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>{open.length} new</span>
          )}
        </h1>
        <p className="text-sm cd-muted">
          Enquiries from the public page. Nothing here is in the diary yet —
          book it on the <Link href="/appointments/new" className="cd-link">booking screen</Link>, then paste the
          appointment id back so it counts.
        </p>
      </div>

      {!config.publicPage.enabled && (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            The public page is not published, so no new requests can arrive. Turn it on under{' '}
            <Link href="/admin/settings" className="cd-link">Business Settings → Public Page</Link>.
          </p>
        </div>
      )}

      <section className="cd-card overflow-hidden">
        <div className="cd-section-header">
          <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>Last 30 days</h2>
          <Link href="/visit" className="text-xs cd-link" target="_blank" rel="noopener noreferrer">View the page →</Link>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-5">
          <Step n={funnel.views} label="page views" />
          <Step n={funnel.requests} label="requests"
            rate={funnel.viewToRequestPct != null ? `${funnel.viewToRequestPct}%` : null} />
          <Step n={funnel.booked} label="booked"
            rate={funnel.requestToBookedPct != null ? `${funnel.requestToBookedPct}%` : null} />
          <Step n={funnel.completed} label="showed up" />
        </div>
        <p className="px-5 pb-4 text-xs cd-muted">
          Views exclude obvious crawlers by user agent, which reduces the noise without eliminating it —
          read the number as a trend, not a headcount.
        </p>
      </section>

      {requests.length === 0 ? (
        <div className="cd-card py-12 text-center">
          <p className="text-sm cd-muted">No requests yet.</p>
        </div>
      ) : (
        requests.map(r => (
          <section key={r.id} className="cd-card overflow-hidden"
            style={{ borderLeft: `3px solid ${r.status === 'New' ? '#B14919' : 'rgba(45,25,7,0.12)'}` }}>
            <div className="cd-section-header">
              <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{r.name}</h2>
              <span className="cd-pill" style={r.status === 'New'
                ? { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
                : { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }}>{r.status}</span>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm" style={{ color: '#2D1907' }}>
                {r.catName ? <>{r.catName} · </> : null}
                {r.serviceName ?? 'no service given'}
                {r.preferredDate ? <> · prefers {r.preferredDate}</> : null}
              </p>
              <p className="text-xs cd-muted">
                {r.phone}{r.email ? ` · ${r.email}` : ''} · {r.createdAt.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {r.handledBy ? ` · handled by ${r.handledBy}` : ''}
              </p>
              {r.notes && (
                <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>{r.notes}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a href={whatsappUrl(r.phone, `Hi ${r.name}, thanks for your booking request with ${config.business.name}.`)}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: '#729094', color: '#F2EDE0' }}>
                  WhatsApp
                </a>
                {['Contacted', 'Declined'].map(s => (
                  <form key={s} action={setRequestStatus} className="inline">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="status" value={s} />
                    <button type="submit" className="text-xs cd-btn-sec">Mark {s.toLowerCase()}</button>
                  </form>
                ))}
              </div>

              {r.appointmentId ? (
                <p className="text-xs" style={{ color: '#5c6b3c' }}>
                  ✓ booked — <Link href={`/appointments`} className="cd-link">appointment {r.appointmentId.slice(-8)}</Link>
                </p>
              ) : (
                <form action={linkAppointment} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input name="appointmentId" placeholder="appointment id once booked"
                    className="cd-input text-xs" style={{ maxWidth: '18rem' }} />
                  <button type="submit" className="text-xs cd-btn-sec">Link booking</button>
                </form>
              )}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function Step({ n, label, rate }: { n: number; label: string; rate?: string | null }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums" style={{ color: '#2D1907' }}>{n.toLocaleString()}</div>
      <div className="text-xs cd-muted">
        {label}{rate ? <span style={{ color: '#B14919' }}> · {rate}</span> : null}
      </div>
    </div>
  )
}
