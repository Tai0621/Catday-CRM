import { db } from './db'
import { normalisePhone } from './phone'

interface CustomerData {
  phone: string
  name?: string
  email?: string
  address?: string
  source?: string
  marketingConsent?: boolean
}

interface CatData {
  name: string
  breed?: string
  gender?: string
  dateOfBirth?: Date
  lifeStage?: string
  healthNotes?: string
}

// Find or create customer; enrich blank fields only (non-destructive)
export async function resolveCustomer(data: CustomerData) {
  const phone = normalisePhone(data.phone)
  const existing = await db.customer.findUnique({ where: { phone } })

  if (!existing) {
    return db.customer.create({
      data: {
        phone,
        name: data.name,
        email: data.email,
        address: data.address,
        source: data.source ?? 'Other',
        marketingConsent: data.marketingConsent ?? false,
      },
    })
  }

  // Only fill blank fields
  return db.customer.update({
    where: { id: existing.id },
    data: {
      name: existing.name ?? data.name,
      email: existing.email ?? data.email,
      address: existing.address ?? data.address,
      marketingConsent: existing.marketingConsent || (data.marketingConsent ?? false),
    },
  })
}

export async function resolveOrCreateCat(customerId: string, cat: CatData) {
  const existing = await db.cat.findFirst({
    where: { customerId, name: { equals: cat.name } },
  })
  if (existing) return existing
  return db.cat.create({ data: { ...cat, customerId } })
}
