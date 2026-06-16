import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeWhatsAppMessage } from '@/lib/whatsapp/analyze'
import { normalisePhone } from '@/lib/phone'

export async function POST(req: Request) {
  // Allow both cron (GET with secret) and manual trigger (POST from UI)
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    // Check if it's an internal/authed request — for now allow POST from authenticated UI
    // In production, add cookie check here
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
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
