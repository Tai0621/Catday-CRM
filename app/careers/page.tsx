import { getConfig } from '@/lib/config'
import { APPLICATION_ROLES } from '@/lib/constants'

// Public careers page — anyone can apply, no login (see proxy PUBLIC_PATHS).
// Chromeless for logged-out visitors (the root layout renders a bare <main>).
export default async function CareersPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams
  const config = await getConfig()

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-10" style={{ background: '#F2EDE0' }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#2D1907', fontFamily: 'var(--font-brand)' }}>Join {config.business.name}</h1>
          <p className="text-sm cd-muted mt-1">{config.business.tagline}</p>
        </div>

        {sent ? (
          <div className="cd-card p-8 text-center space-y-2" style={{ background: '#FBF8EF' }}>
            <div className="text-3xl">🐾</div>
            <h2 className="font-bold text-lg" style={{ color: '#2D1907' }}>Thank you for applying!</h2>
            <p className="text-sm cd-muted">We&apos;ve received your application and will be in touch if there&apos;s a good fit.</p>
          </div>
        ) : (
          <form action="/api/careers" method="POST" className="cd-card p-6 space-y-4" style={{ background: '#FBF8EF' }}>
            {error && (
              <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium" style={{ background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
                Please fill in at least your name and phone number.
              </div>
            )}
            {/* Honeypot — hidden from people, catches bots */}
            <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="cd-label">Full name *</label>
                <input name="name" required className="cd-input" placeholder="Your name" />
              </div>
              <div>
                <label className="cd-label">Phone *</label>
                <input name="phone" required className="cd-input" placeholder="e.g. 012-345 6789" />
              </div>
            </div>
            <div>
              <label className="cd-label">Email</label>
              <input name="email" type="email" className="cd-input" placeholder="you@example.com" />
            </div>
            <div>
              <label className="cd-label">Role you&apos;re applying for</label>
              <select name="roleApplied" className="cd-input" defaultValue="">
                <option value="">— select —</option>
                {APPLICATION_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="cd-label">Experience</label>
              <textarea name="experience" rows={3} className="cd-input" placeholder="Tell us a bit about your experience with cats / grooming / hospitality…" />
            </div>
            <div>
              <label className="cd-label">Availability</label>
              <input name="availability" className="cd-input" placeholder="e.g. weekdays, can start next month" />
            </div>
            <button type="submit" className="w-full py-3 rounded-xl text-sm font-semibold" style={{ background: '#B14919', color: '#F7F0E1' }}>
              Submit application
            </button>
            <p className="text-center text-xs cd-muted">
              By applying you agree to us processing your details for recruitment · <a href="/privacy" className="cd-link">Privacy</a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
