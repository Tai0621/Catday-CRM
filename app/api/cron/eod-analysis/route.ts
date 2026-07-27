import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeWhatsAppMessage } from '@/lib/whatsapp/analyze'
import { normalisePhone } from '@/lib/phone'
import { getSession, isManager } from '@/lib/auth'
import { safeEqual } from '@/lib/http-security'

// This endpoint spends Anthropic tokens, so it is fail-closed: the scheduled run
// carries the CRON_SECRET bearer token; the manual "Run analysis" button on the
// (manager-only) WhatsApp page carries a signed-in manager session. Nothing else
// gets in.
async function authorized(req: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (cronSecret && auth.startsWith('Bearer ') && safeEqual(auth.slice(7), cronSecret)) return true
  return isManager(await getSession())
}

export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const unprocessed = await db.whatsAppMessage.findMany({
    where: { processed: false },
    take: 50,
  })

  let processed = 0

  for (const msg of unprocessed) {
    try {
      const extraction = await analyzeWhatsAppMessage(msg.content, msg.senderPhone)

      const phone = normalisePhone(msg.senderPhone)
      const customer = await db.customer.findUnique({ where: { phone } })

      await db.whatsAppLead.create({
        data: {
          messageId: msg.id,
          customerId: customer?.id ?? null,
          type: extraction.type,
          status: 'Pending',
          summary: extraction.summary,
          proposedAction: extraction.proposedAction,
          confidence: extraction.confidence,
        },
      })

      await db.whatsAppMessage.update({
        where: { id: msg.id },
        data: { processed: true },
      })

      processed++
    } catch (err) {
      console.error(`Failed to analyse message ${msg.id}:`, err)
    }
  }

  return NextResponse.json({ processed, total: unprocessed.length })
}

export async function GET(req: Request) {
  // Vercel Cron calls GET with the bearer token; POST re-checks it too.
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
