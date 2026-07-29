import { db } from './db'

// Track A / A2 — data-subject access & portability. Assembles a complete,
// machine-readable copy of everything the OS holds about one customer, for the
// GDPR "right of access / data portability" and PDPA equivalents. Read-only;
// never mutates. Manager-gated at the route boundary + audit-logged there.
//
// Media bytes live in private Blob and aren't inlined — the export lists each
// asset's metadata + URL (reachable only through the authenticated proxy) so the
// bundle stays a sane size; the actual files can be handed over separately.

export type CustomerExport = Awaited<ReturnType<typeof buildCustomerExport>>

export async function buildCustomerExport(customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) return null

  const cats = await db.cat.findMany({ where: { customerId } })
  const catIds = cats.map(c => c.id)

  const [assessments, memberships, appointments, transactions, loyaltyEntries, walletEntries, leads] =
    await Promise.all([
      catIds.length
        ? db.catAssessment.findMany({ where: { catId: { in: catIds } }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([]),
      db.membership.findMany({ where: { customerId }, include: { tier: { select: { name: true, cardType: true } } }, orderBy: { createdAt: 'desc' } }),
      db.appointment.findMany({ where: { customerId }, include: { cat: { select: { name: true } }, room: { select: { name: true } } }, orderBy: { scheduledAt: 'desc' } }),
      db.transaction.findMany({ where: { customerId }, include: { lines: true }, orderBy: { date: 'desc' } }),
      db.loyaltyEntry.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
      db.walletEntry.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
      db.whatsAppLead.findMany({ where: { customerId }, include: { message: { select: { content: true, timestamp: true, senderPhone: true } } }, orderBy: { createdAt: 'desc' } }),
    ])

  const assessmentIds = assessments.map(a => a.id)
  const media = await db.mediaAsset.findMany({
    where: {
      OR: [
        catIds.length ? { ownerType: 'cat', ownerId: { in: catIds } } : { id: '__none__' },
        assessmentIds.length ? { ownerType: 'assessment', ownerId: { in: assessmentIds } } : { id: '__none__' },
      ],
    },
    select: { id: true, url: true, kind: true, contentType: true, ownerType: true, ownerId: true, tag: true, caption: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      subject: 'customer',
      customerId,
      note: 'Complete record held by the Cat Day Business OS. Media files are referenced by URL (served only to authenticated staff via the media proxy); bytes are not inlined.',
    },
    profile: customer,
    cats,
    catAssessments: assessments,
    memberships,
    appointments,
    transactions,
    loyaltyLedger: loyaltyEntries,
    walletLedger: walletEntries,
    whatsapp: leads,
    media,
    counts: {
      cats: cats.length,
      assessments: assessments.length,
      memberships: memberships.length,
      appointments: appointments.length,
      transactions: transactions.length,
      loyaltyEntries: loyaltyEntries.length,
      walletEntries: walletEntries.length,
      whatsappLeads: leads.length,
      media: media.length,
    },
  }
}

// A filesystem-safe filename for the downloaded bundle.
export function exportFilename(customer: { name: string | null; phone: string }): string {
  const who = (customer.name ?? customer.phone).replace(/[^\w.\-]+/g, '_').slice(0, 40)
  const day = new Date().toISOString().slice(0, 10)
  return `catday-export-${who}-${day}.json`
}
