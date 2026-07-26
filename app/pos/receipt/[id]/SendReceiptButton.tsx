'use client'

import { useRouter } from 'next/navigation'
import { markReceiptSent } from './actions'

// One tap: opens WhatsApp with the receipt (the anchor's default, so no
// popup-blocker fight) while recording the send in the background.
export function SendReceiptButton({ id, waUrl }: { id: string; waUrl: string }) {
  const router = useRouter()
  return (
    <a
      href={waUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => { markReceiptSent(id, 'WhatsApp').then(() => router.refresh()) }}
      className="text-sm px-3 py-2 rounded-lg"
      style={{ background: '#729094', color: '#F2EDE0' }}
    >
      WhatsApp receipt
    </a>
  )
}
