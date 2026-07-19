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
    const msg = `Delete this transaction${grouped ? ' and its linked payment rows' : ''} (${label}, RM ${amount.toFixed(2)})?\n\nThis removes it from revenue, the income statement and the cash-up — and reverses any loyalty points, wallet payment and product stock from this sale.`
    if (!window.confirm(msg)) return
    setErr(null)
    start(async () => {
      const res = await deleteTransaction(id)
      if (!res.ok) { setErr(res.error); return }
      const undone: string[] = []
      if (res.pointsReversed) undone.push(`−${res.pointsReversed} pts`)
      if (res.walletRefunded) undone.push(`+RM ${res.walletRefunded.toFixed(2)} wallet`)
      if (res.restocked) undone.push(`+${res.restocked} stock`)
      if (undone.length) window.alert(`Deleted. Reversed: ${undone.join(' · ')}.`)
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
