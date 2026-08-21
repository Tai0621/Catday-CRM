import { getConfig } from '@/lib/config'
import { getReceiptByToken } from '@/lib/receipt'
import { renderReceiptPdf } from '@/lib/receipt-pdf'

// The customer's receipt link. Serves a PDF, not a page.
//
// This used to render an HTML receipt on the app's own domain. It was public
// and it showed nothing but the sale, but it was still a Cat Day OS page: a
// URL a curious recipient could edit, a document with the app's chrome and
// stylesheet behind it. A PDF has no links, no navigation and no server to
// probe, so "the customer can see their receipt" stops implying "the customer
// has been handed a way into the system".
//
// Old links keep working: the path is unchanged, only what it returns.
// `/r/` is in proxy.ts PUBLIC_PATHS, so there is no login in front of it; the
// unguessable token is the whole guard, which is why it is 64 hex characters.

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [config, view] = await Promise.all([getConfig(), getReceiptByToken(token)])
  if (!view) return new Response('Receipt not found', { status: 404 })

  const pdf = await renderReceiptPdf(view, config.business, config.brand.logoUrl)
  const name = `receipt-${(view.reference ?? view.id).replace(/[^A-Za-z0-9._-]/g, '')}.pdf`

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` so tapping the link in WhatsApp opens the reader rather than
      // starting a download the customer then has to go and find.
      'Content-Disposition': `inline; filename="${name}"`,
      // A receipt never changes, but it must never be cached by a shared proxy
      // either: the token is the only thing keeping it private.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
