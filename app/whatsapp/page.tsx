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
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>WhatsApp Hub</h1>
        <div className="flex gap-2">
          {unprocessed > 0 && (
            <form action="/api/cron/eod-analysis" method="POST">
              <button className="text-sm px-3 py-2 rounded-lg"
                style={{ background: '#E7CE7A', color: '#2D1907' }}>
                Analyse {unprocessed} messages
              </button>
            </form>
          )}
          <Link href="/whatsapp/import" className="cd-btn-sec text-sm">Import CSV</Link>
        </div>
      </div>

      <div className="flex gap-2 text-sm">
        {['Pending', 'Confirmed', 'Dismissed'].map(s => (
          <Link key={s} href={`?status=${s}`}
            className="px-3 py-1.5 rounded-lg transition-colors"
            style={filterStatus === s
              ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
              : { background: 'rgba(45,25,7,0.07)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }
            }>
            {s}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {leads.length === 0 && (
          <div className="cd-card py-12 text-center cd-muted">No {filterStatus.toLowerCase()} leads</div>
        )}
        {leads.map(lead => (
          <div key={lead.id} className="cd-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="cd-pill" style={leadTypeStyle(lead.type)}>{lead.type}</span>
                  <span className="text-xs cd-muted">{displayPhone(lead.message.senderPhone)}</span>
                  {lead.customer && (
                    <Link href={`/customers/${lead.customerId}`} className="text-xs cd-link">
                      {lead.customer.name ?? lead.customer.phone}
                    </Link>
                  )}
                  <span className="text-xs cd-muted ml-auto">{lead.createdAt.toLocaleDateString('en-MY')}</span>
                </div>
                <p className="text-sm font-medium" style={{ color: '#2D1907' }}>{lead.summary}</p>
                {lead.proposedAction && (
                  <p className="text-xs cd-muted mt-1">Suggested: {lead.proposedAction}</p>
                )}
                <p className="text-xs cd-muted mt-2 line-clamp-2">{lead.message.content}</p>
              </div>
            </div>
            {filterStatus === 'Pending' && (
              <div className="flex gap-2">
                <form action={updateLeadStatus}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button name="status" value="Confirmed"
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ background: 'rgba(114,144,148,0.2)', color: '#729094' }}>
                    Confirm
                  </button>
                </form>
                <form action={updateLeadStatus}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button name="status" value="Dismissed"
                    className="text-xs px-3 py-1.5 rounded cd-btn-sec">
                    Dismiss
                  </button>
                </form>
                {lead.type === 'BookingRequest' && (
                  <Link href={`/appointments/new?customerId=${lead.customerId ?? ''}`}
                    className="text-xs px-3 py-1.5 rounded cd-btn">
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

function leadTypeStyle(type: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    BookingRequest: { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Inquiry:        { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    Complaint:      { background: 'rgba(177,73,25,0.2)', color: '#8a2200' },
    Reschedule:     { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    Cancellation:   { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' },
    Other:          { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' },
  }
  return m[type] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' }
}
