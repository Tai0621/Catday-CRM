import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createHmac } from 'crypto'
import { safeEqual } from '@/lib/http-security'

// WhatsApp Cloud API webhook
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(req: Request) {
  const body = await req.text()

  // Verify the Meta HMAC signature. Fail-closed in production: a missing secret
  // means the webhook is misconfigured, not that anyone may post — only local
  // dev is allowed to skip it.
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (appSecret) {
    const sig = req.headers.get('x-hub-signature-256') ?? ''
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex')
    if (!safeEqual(sig, expected)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const payload = JSON.parse(body)
  const entry = payload?.entry?.[0]
  const changes = entry?.changes?.[0]
  const messages = changes?.value?.messages

  if (!messages?.length) {
    return NextResponse.json({ status: 'no messages' })
  }

  for (const msg of messages) {
    if (msg.type !== 'text') continue
    const externalId = msg.id
    const senderPhone = msg.from
    const content = msg.text?.body ?? ''
    const timestamp = new Date(parseInt(msg.timestamp, 10) * 1000)

    try {
      await db.whatsAppMessage.upsert({
        where: { externalId },
        create: { externalId, senderPhone, content, timestamp },
        update: {},
      })
    } catch {
      // Duplicate — ignore
    }
  }

  return NextResponse.json({ status: 'ok' })
}
