import { notFound } from 'next/navigation'
import { getConfig } from '@/lib/config'
import { getReceiptByToken } from '@/lib/receipt'
import { ReceiptCard } from '@/app/components/ReceiptCard'

// Public, login-free receipt — the link the customer opens from WhatsApp.
// Guarded only by the unguessable token; no auth (see proxy.ts PUBLIC_PATHS).
export default async function PublicReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [config, view] = await Promise.all([getConfig(), getReceiptByToken(token)])
  if (!view) notFound()

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-10" style={{ background: '#F2EDE0' }}>
      <div className="w-full max-w-sm">
        <ReceiptCard view={view} business={config.business} />
        <p className="text-center text-xs cd-muted mt-4">Digital receipt from {config.business.name}</p>
      </div>
    </div>
  )
}
