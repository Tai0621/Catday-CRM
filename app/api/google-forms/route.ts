import { NextResponse } from 'next/server'
import { resolveCustomer, resolveOrCreateCat } from '@/lib/customer-resolve'
import { safeEqual } from '@/lib/http-security'

// Google Forms webhook via Apps Script
// Apps Script should POST JSON to this endpoint with the form response
// Example Apps Script: see DEPLOY.md
export async function POST(req: Request) {
  // This endpoint ingests customer PII, so it is fail-closed in production: a
  // missing secret means misconfiguration, not open access. Local dev may skip.
  const secret = process.env.GOOGLE_FORMS_SECRET
  if (secret) {
    const auth = req.headers.get('x-webhook-secret') ?? ''
    if (!safeEqual(auth, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const body = await req.json()

  // Expected fields (map your Google Form question IDs here):
  // phone, name, email, address, marketingConsent
  // cat_1_name, cat_1_breed, cat_1_gender, cat_1_lifeStage, cat_1_dob, cat_1_healthNotes
  // cat_2_name, ... (up to 5 cats)

  const phone = body.phone as string
  if (!phone) {
    return NextResponse.json({ error: 'Phone is required' }, { status: 400 })
  }

  const customer = await resolveCustomer({
    phone,
    name: body.name,
    email: body.email,
    address: body.address,
    source: 'GoogleForm',
    marketingConsent: body.marketingConsent === true || body.marketingConsent === 'Yes',
  })

  const catsCreated: string[] = []

  for (let i = 1; i <= 5; i++) {
    const catName = body[`cat_${i}_name`] as string | undefined
    if (!catName) break

    const cat = await resolveOrCreateCat(customer.id, {
      name: catName,
      breed: body[`cat_${i}_breed`] ?? null,
      gender: body[`cat_${i}_gender`] ?? null,
      lifeStage: body[`cat_${i}_lifeStage`] ?? null,
      dateOfBirth: body[`cat_${i}_dob`] ? new Date(body[`cat_${i}_dob`]) : undefined,
      healthNotes: body[`cat_${i}_healthNotes`] ?? null,
    })

    catsCreated.push(cat.id)
  }

  return NextResponse.json({
    customerId: customer.id,
    catsCreated,
  })
}
