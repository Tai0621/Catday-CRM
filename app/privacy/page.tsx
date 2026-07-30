import { getConfig } from '@/lib/config'

// Public privacy notice (A4) — the customer-facing summary linked from the job
// application form and the digital receipt. Login-free (see proxy PUBLIC_PATHS).
// The full internal data map lives in docs/PRIVACY.md.
export const dynamic = 'force-dynamic'

export default async function PrivacyPage() {
  const config = await getConfig()
  const biz = config.business
  const name = biz.name
  const contact = biz.email || biz.phone

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-10" style={{ background: '#F2EDE0' }}>
      <div className="w-full max-w-2xl cd-card p-6 md:p-8 space-y-5" style={{ color: '#2D1907' }}>
        <div>
          <h1 className="text-2xl font-bold">Privacy Notice</h1>
          <p className="text-sm cd-muted mt-1">How {name} handles your personal information.</p>
        </div>

        <Section title="What we collect">
          Your contact details (name, phone, email, address), your pets&apos; care and
          health information, your bookings and purchase history, and — if you take
          part — loyalty and membership records. We collect this to provide grooming
          and boarding services, manage your account, and (only with your consent)
          send you updates and offers.
        </Section>

        <Section title="How we keep it safe">
          Your data is held in {name}&apos;s own secured system, not sold or shared with
          third parties for their marketing. Access is limited to our staff, over
          encrypted connections. Photos of your pets are stored privately and shown
          only to our team.
        </Section>

        <Section title="Your rights">
          You may ask us to (a) show you a copy of the data we hold about you,
          (b) correct anything that&apos;s wrong, (c) stop sending you marketing at any
          time, or (d) erase your personal information. When you ask us to erase your
          data we anonymise it right away; some transaction records are kept for the
          period the law requires for accounting and tax, then removed.
        </Section>

        <Section title="Contact">
          To exercise any of these rights, or if you have any questions, contact us
          {contact ? <> at <span className="font-medium">{contact}</span></> : <> at the shop</>}.
        </Section>

        <p className="text-xs cd-muted pt-2">{name} · Privacy Notice</p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm leading-relaxed" style={{ color: 'rgba(45,25,7,0.85)' }}>{children}</p>
    </section>
  )
}
