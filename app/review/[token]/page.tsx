import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { answerReview, goToReview } from './actions'
import { notFound } from 'next/navigation'

// M4 · The public review page. No login — the customer opens this from a
// WhatsApp link, so the token is the only credential and the route is in
// PUBLIC_PATHS.
//
// One question first, then two different destinations. The happy path goes out
// to the public review site; the unhappy path stays here and becomes an
// Incident, so somebody at the business hears it and can put it right.
export default async function ReviewPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}) {
  const { token } = await params
  const { state } = await searchParams

  const [req, config] = await Promise.all([
    db.reviewRequest.findUnique({
      where: { token },
      select: { id: true, respondedAt: true, sentiment: true, customer: { select: { name: true } } },
    }),
    getConfig(),
  ])
  if (!req) notFound()

  const brand = config.business.name
  const reviewUrl = config.marketing.reviewUrl.trim()
  const firstName = (req.customer.name ?? '').split(' ')[0]

  const answered = !!req.respondedAt
  const positive = req.sentiment === 'Positive'

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="cd-card p-6 w-full space-y-4" style={{ maxWidth: 460 }}>
        {!answered && state !== 'thanks' && state !== 'sorry' ? (
          <>
            <div>
              <h1 className="text-lg font-bold" style={{ color: '#2D1907' }}>
                {firstName ? `Hi ${firstName} —` : 'Hi —'} how did it go?
              </h1>
              <p className="text-sm cd-muted">
                One question, and it goes straight to the {brand} team.
              </p>
            </div>

            <form action={answerReview} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="sentiment" value="Positive" />
              <button type="submit" className="cd-btn w-full py-3">It went well</button>
            </form>

            <details className="space-y-3">
              <summary className="cursor-pointer text-sm cd-muted">Something wasn&rsquo;t right</summary>
              <form action={answerReview} className="space-y-2 mt-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="sentiment" value="Negative" />
                <label className="cd-label">What happened?</label>
                <input name="detail" className="cd-input" placeholder="Tell us what we got wrong" maxLength={500} />
                <button type="submit" className="cd-btn-sec w-full py-2.5">Send this to the team</button>
              </form>
            </details>
          </>
        ) : positive || state === 'thanks' ? (
          <>
            <h1 className="text-lg font-bold" style={{ color: '#2D1907' }}>That&rsquo;s lovely to hear.</h1>
            <p className="text-sm cd-muted">
              {reviewUrl
                ? `If you have a moment, a public review helps other cat owners find ${brand}.`
                : `Thank you — we'll pass it on to the team.`}
            </p>
            {reviewUrl && (
              <form action={goToReview}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="cd-btn w-full py-3">Leave a review</button>
              </form>
            )}
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold" style={{ color: '#2D1907' }}>Thank you for telling us.</h1>
            <p className="text-sm cd-muted">
              This has gone to the {brand} team and someone will look into it. We&rsquo;d rather hear it
              from you than not at all.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
