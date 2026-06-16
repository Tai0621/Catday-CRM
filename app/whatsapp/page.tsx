import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { displayPhone } from '@/lib/phone'

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAuth()
  const { status } = await searchParams
  const filterStatus = status ?? 'Pending'

  const [leads, unprocessed] = await Promise.all([
    db.whatsAppLead.findMany({
      where: { status: filterStatus },
      include: { message: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.whatsAppMessage.count({ where: { processed: false } }),
  ])

  async function updateLeadStatus(data: FormData) {
    'use server'
    const leadId = data.get('leadId') as string
    const newStatus = data.get('status') as string
    await db.whatsAppLead.update({ where: { id: leadId }, data: { status: newStatus } })
    redirect('/whatsapp')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">WhatsApp Hub</h1>
        <div className="flex gap-2">
          {unprocessed > 0 && (
            <form action="/api/cron/eod-analysis" method="POST">
              <button className="text-sm bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600">
                Analyse {unprocessed} messages
              </button>
            </form>
          )}
          <Link href="/whatsapp/import" className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200">
            Import CSV
          </Link>
        </div>
      </div>

      <div className="flex gap-2 text-sm">
        {['Pending', 'Confirmed', 'Dismissed'].map(s => (
          <Link key={s} href={`?status=${s}`}
            className={`px-3 py-1.5 rounded-lg border ${filterStatus === s ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {s}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {leads.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
            No {filterStatus.toLowerCase()} leads
          </div>
        )}
        {leads.map(lead => (
          <div key={lead.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${leadTypeClass(lead.type)}`}>{lead.type}</span>
                  <span className="text-xs text-gray-400">{displayPhone(lead.message.senderPhone)}</span>
                  {lead.customer && (
                    <Link href={`/customers/${lead.customerId}`} className="text-xs text-rose-600 hover:underline">
                      {lead.customer.name ?? lead.customer.phone}
                    </Link>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">{lead.createdAt.toLocaleDateString('en-MY')}</span>
                </div>
                <p className="text-sm font-medium text-gray-900">{lead.summary}</p>
                {lead.proposedAction && (
                  <p className="text-xs text-gray-500 mt-1">Suggested: {lead.proposedAction}</p>
                )}
                <p className="text-xs text-gray-400 mt-2 line-clamp-2">{lead.message.content}</p>
              </div>
            </div>
            {filterStatus === 'Pending' && (
              <div className="flex gap-2">
                <form action={updateLeadStatus}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button name="status" value="Confirmed" className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700">
                    Confirm
                  </button>
                </form>
                <form action={updateLeadStatus}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button name="status" value="Dismissed" className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-200">
                    Dismiss
                  </button>
                </form>
                {lead.type === 'BookingRequest' && (
                  <Link href={`/appointments/new?customerId=${lead.customerId ?? ''}`}
                    className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded hover:bg-rose-700">
                    Book appointment
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function leadTypeClass(type: string) {
  const m: Record<string, string> = {
    BookingRequest: 'bg-rose-100 text-rose-700',
    Inquiry: 'bg-blue-100 text-blue-700',
    Complaint: 'bg-red-100 text-red-700',
    Reschedule: 'bg-amber-100 text-amber-700',
    Cancellation: 'bg-gray-100 text-gray-600',
    Other: 'bg-gray-100 text-gray-600',
  }
  return m[type] ?? 'bg-gray-100 text-gray-600'
}
