import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { ENROLLMENT_STATUSES } from '@/lib/constants'
import { loadAcademy, unconverted, ACADEMY_FOLLOWUP_AFTER_DAYS } from '@/lib/academy'
import { whatsappUrl } from '@/lib/phone'
import { SEGMENTS } from '@/lib/segments'
import { enroll, relinkAttendees } from './actions'
import Link from 'next/link'

// M7 · The Academy as a funnel.
//
// Workshops are lead generation for grooming, so the question this page has to
// answer is not "how many enrolled" but "how many came back" — and, more
// usefully, "who hasn't yet".
export default async function AcademyPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAuth()
  const { status } = await searchParams

  const [{ attendees, funnel }, config] = await Promise.all([loadAcademy(), getConfig()])
  const seg = SEGMENTS.community
  const brand = config.business.name

  const shown = status ? attendees.filter(a => a.status === status) : attendees
  const statMap: Record<string, number> = {}
  for (const a of attendees) statMap[a.status] = (statMap[a.status] ?? 0) + 1
  const chase = unconverted(attendees)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Academy
        </h1>
        <p className="text-sm cd-muted">
          Workshops are lead generation for grooming. This is how many attendees came back.
        </p>
      </div>

      {/* ── The funnel ── */}
      <section className="cd-card overflow-hidden">
        <div className="cd-section-header">
          <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>Attendee → customer</h2>
          <form action={relinkAttendees}>
            <button type="submit" className="text-xs cd-link">Re-match attendees</button>
          </form>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-6">
          <Step n={funnel.enrolled} label="enrolled" />
          <Step n={funnel.linked} label="known to the CRM" pct={funnel.linkedPct} />
          <Step n={funnel.booked} label="booked a groom after" pct={funnel.bookedPct} />
          <Step n={funnel.attended} label="actually came" />
          <Step n={funnel.members} label="became members" pct={funnel.memberPct} />
        </div>
        <div className="px-5 pb-4 space-y-1">
          <p className="text-sm" style={{ color: '#2D1907' }}>
            RM {funnel.revenueAfterRM.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
            <span className="cd-muted"> spent by attendees since they enrolled</span>
          </p>
          <p className="text-xs cd-muted">
            Only bookings made <em>after</em> the enrolment date count — a regular who takes a class
            did not convert because of it. Attendees with no phone or email match are not counted as
            reached; use <strong>Re-match</strong> after they sign up as customers.
          </p>
        </div>
      </section>

      {/* ── The actionable half ── */}
      {chase.length > 0 && (
        <section className="cd-card overflow-hidden" style={{ borderLeft: `3px solid ${seg.color}` }}>
          <div className="cd-section-header">
            <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>
              Worth a follow-up <span className="cd-pill ml-1" style={{ background: 'rgba(122,138,79,0.2)', color: '#5c6b3c' }}>{chase.length}</span>
            </h2>
            <Link href="/actions" className="text-xs cd-link">Also in the Action Inbox →</Link>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs cd-muted">
              Enjoyed a class at least {ACADEMY_FOLLOWUP_AFTER_DAYS} days ago and never booked a groom.
            </p>
            {chase.slice(0, 12).map(a => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <div>
                  <span className="text-sm font-medium" style={{ color: '#2D1907' }}>{a.studentName}</span>
                  <span className="text-xs cd-muted"> · {a.course} · {a.daysSinceEnrolment} days ago</span>
                </div>
                {a.phone && (
                  <a href={whatsappUrl(a.phone, `Hi ${a.studentName}! Lovely having you at our ${a.course} session 🐾 If you'd like us to take care of the next groom ourselves at ${brand}, we'd be glad to — shall we find you a time?`)}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: '#729094', color: '#F2EDE0' }}>WhatsApp</a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-4 gap-3">
        {ENROLLMENT_STATUSES.map(s => (
          <Link key={s} href={status === s ? '/academy' : `?status=${s}`}
            className="rounded-xl px-4 py-3 text-center hover:opacity-85 transition-opacity"
            style={status === s
              ? { background: '#B14919', border: '1px solid #B14919' }
              : { background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }}>
            <div className="text-xl font-bold" style={{ color: status === s ? '#ECDBB6' : '#2D1907' }}>
              {statMap[s] ?? 0}
            </div>
            <div className="text-xs" style={{ color: status === s ? 'rgba(236,219,182,0.75)' : 'rgba(45,25,7,0.45)' }}>{s}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 cd-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th className="px-4 py-2 text-left">Student</th>
              <th className="px-4 py-2 text-left">Course</th>
              <th className="px-4 py-2 text-left">Enrolled</th>
              <th className="px-4 py-2 text-left">Since</th>
            </tr></thead>
            <tbody className="cd-tbody">
              {shown.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center cd-muted">No enrollments yet</td></tr>
              )}
              {shown.map(a => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium" style={{ color: '#2D1907' }}>
                      {a.customerId
                        ? <Link href={`/customers/${a.customerId}`} className="cd-link">{a.studentName}</Link>
                        : a.studentName}
                    </div>
                    <div className="text-xs cd-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3 cd-muted">{a.course}</td>
                  <td className="px-4 py-3 cd-muted">{a.enrolledAt.toLocaleDateString('en-MY')}</td>
                  <td className="px-4 py-3">
                    <Outcome attendee={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cd-card p-5">
          <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>New Enrollment</h2>
          <form action={enroll} className="space-y-3">
            <div>
              <label className="cd-label">Student Name *</label>
              <input name="studentName" required placeholder="Full name" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Email *</label>
              <input name="email" type="email" required placeholder="email@example.com" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Phone</label>
              <input name="phone" placeholder="012-3456789" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Course *</label>
              <input name="course" required placeholder="e.g. Cat Grooming Basics" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Notes</label>
              <textarea name="notes" rows={2} placeholder="Optional…" className="cd-input" style={{ resize: 'none' }} />
            </div>
            <button type="submit" className="cd-btn w-full text-center">Enroll Student</button>
            <p className="text-xs cd-muted">
              Matched to an existing customer by phone, then email — that link is what the funnel counts.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

function Outcome({ attendee }: { attendee: { customerId: string | null; bookedAt: Date | null; isMember: boolean } }) {
  if (attendee.isMember) {
    return <span className="cd-pill" style={{ background: 'rgba(184,144,43,0.2)', color: '#8a6a14' }}>member</span>
  }
  if (attendee.bookedAt) {
    return <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.2)', color: '#5c6b3c' }}>
      booked {attendee.bookedAt.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}
    </span>
  }
  if (!attendee.customerId) {
    return <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.45)' }}>not a customer</span>
  }
  return <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.13)', color: '#B14919' }}>no groom yet</span>
}

function Step({ n, label, pct }: { n: number; label: string; pct?: number | null }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums" style={{ color: '#2D1907' }}>{n.toLocaleString()}</div>
      <div className="text-xs cd-muted">
        {label}{pct != null ? <span style={{ color: SEGMENTS.community.text }}> · {pct}%</span> : null}
      </div>
    </div>
  )
}
