'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteMediaAsset } from '@/app/media/actions'

export function DeleteMediaButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); await deleteMediaAsset(id); router.refresh() }}
      className="absolute top-1 right-1 rounded-full w-6 h-6 flex items-center justify-center text-sm leading-none"
      style={{ background: 'rgba(45,25,7,0.72)', color: '#F2EDE0' }}
      title="Remove"
      aria-label="Remove"
    >
      ×
    </button>
  )
}
