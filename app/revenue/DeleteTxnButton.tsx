'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTransaction } from './actions'

// Manager tool: remove a wrongly-recorded transaction. Confirms first, and
// warns when the row is part of a linked group (split POS payment).
export function DeleteTxnButton({ id, amount, label, grouped }: {
  id: string; amount: number; label: string; grouped: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function onClick() {
    const msg = grouped
      ? `Delete this transaction and its linked payment rows (${label}, RM ${amount.toFixed(2)})?\n\nThis removes it from revenue, the income statement and the cash-up. It does not restock products or refund points.`
      : `Delete this transaction (${label}, RM ${amount.toFixed(2)})?\n\nThis removes it from revenue, the income statement and the cash-up.`
    if (!window.confirm(msg)) return
    setErr(null)
    start(async () => {
      const res = await deleteTransaction(id)
      if (!res.ok) { setErr(res.error); return }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={onClick} disabled={pending}
        className="text-xs px-2 py-0.5 rounded hover:opacity-80 disabled:opacity-50"
        style={{ color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}
        title="Delete this transaction">
        {pending ? '…' : 'Delete'}
      </button>
      {err && <span className="text-xs" style={{ color: '#B14919' }}>{err}</span>}
    </span>
  )
}
