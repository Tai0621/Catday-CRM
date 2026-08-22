import { requireManager } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { contentPool, poolExclusions } from '@/lib/content/studio'
import { SEGMENTS } from '@/lib/segments'
import { PairExport } from './PairExport'
import { aiConfigured } from '@/lib/ai/provider'
import { generateCaption, setDraftStatus, withdrawFromPool } from './actions'
import Link from 'next/link'
import { SubmitButton } from '@/app/components/Pending'

// M3 · Content Studio.
//
// The consent gate is the feature, so it is shown rather than merely applied:
// every card carries the badge, the excluded count is stated, and withdrawing a
// cat is one click from the same screen.
export default async function ContentStudioPage() {
  await requireManager()
  const [pool, excluded, config] = await Promise.all([contentPool(), poolExclusions(), getConfig()])
  const seg = SEGMENTS.community
  // Asks the provider seam, not one provider's env var: the demo runs on
  // Groq and would otherwise hide a working feature behind the
  // "not configured" state.
  const configured = aiConfigured()

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Content Studio
        </h1>
        <p className="text-sm cd-muted">
          Before/after pairs from completed grooms, ready to post — a composed image and a drafted
          caption. Nothing is published from here; you post it yourself.
        </p>
      </div>

      <div className="cd-card p-4 space-y-1" style={{ borderLeft: `3px solid ${seg.color}` }}>
        <p className="text-sm" style={{ color: '#2D1907' }}>
          Only households who agreed to marketing <strong>and</strong> whose cat has not been withdrawn
          appear here.
        </p>
        <p className="text-xs cd-muted">
          {excluded.noConsent} completed groom{excluded.noConsent === 1 ? '' : 's'} excluded for no marketing
          consent{excluded.optedOut > 0 ? `, ${excluded.optedOut} because the cat was withdrawn from the pool` : ''}.
          Agreeing to be messaged and agreeing to have your cat published are separate permissions —
          withdrawing a cat here does not stop the household hearing from you.
        </p>
      </div>

      {!configured && (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            No AI provider key on this deployment, so captions cannot be drafted. The
            image composer below still works.
          </p>
        </div>
      )}

      {pool.length === 0 ? (
        <div className="cd-card py-12 text-center">
          <p className="text-sm cd-muted">
            Nothing ready yet. A groom appears here once it is completed and has both a before and an
            after photo — take those on the{' '}
            <Link href="/board" className="cd-link">service board</Link>.
          </p>
        </div>
      ) : (
        pool.map(c => (
          <section key={c.appointmentId} className="cd-card overflow-hidden">
            <div className="cd-section-header">
              <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>
                {c.catName}
                <span className="cd-muted font-normal">
                  {c.breed ? ` · ${c.breed}` : ''} · {c.serviceName} · {c.date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                </span>
              </h2>
              <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.2)', color: '#5c6b3c' }}>
                consented
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              <PairExport
                beforeId={c.beforeMediaId}
                afterId={c.afterMediaId}
                catName={c.catName}
                ink={config.brand.ink}
                accent={config.brand.primary}
              />

              {c.draft ? (
                <div className="space-y-2">
                  <p className="text-sm whitespace-pre-wrap" style={{ color: '#2D1907' }}>{c.draft.caption}</p>
                  {c.draft.hashtags.length > 0 && (
                    <p className="text-xs" style={{ color: seg.text }}>{c.draft.hashtags.join(' ')}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={generateCaption}>
                      <input type="hidden" name="appointmentId" value={c.appointmentId} />
                      <SubmitButton className="text-xs cd-btn-sec" disabled={!configured} busyLabel="Working…">Rewrite</SubmitButton>
                    </form>
                    {(['Used', 'Discarded'] as const).map(s => (
                      <form key={s} action={setDraftStatus}>
                        <input type="hidden" name="appointmentId" value={c.appointmentId} />
                        <input type="hidden" name="status" value={s} />
                        <SubmitButton className="text-xs cd-link" busyLabel="Working…">Mark {s.toLowerCase()}</SubmitButton>
                      </form>
                    ))}
                    {c.draft.status !== 'Draft' && (
                      <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }}>
                        {c.draft.status.toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <form action={generateCaption}>
                  <input type="hidden" name="appointmentId" value={c.appointmentId} />
                  <SubmitButton className="cd-btn text-sm" disabled={!configured} busyLabel="Working…">Draft a caption</SubmitButton>
                </form>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href={`/customers/${c.customerId}`} className="text-xs cd-link">{c.customerName}</Link>
                <form action={withdrawFromPool}>
                  <input type="hidden" name="catId" value={c.catId} />
                  <SubmitButton className="text-xs" style={{ color: '#B14919' }} busyLabel="Working…">
                    Withdraw {c.catName} from the content pool
                  </SubmitButton>
                </form>
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
