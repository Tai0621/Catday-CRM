import { db } from './db'

/** Top up the Cat Day Wallet: records the top-up (and bonus) and bumps the balance. */
export async function topUpWallet(customerId: string, amount: number, bonus: number, note?: string) {
  if (amount <= 0) return
  await db.$transaction([
    db.walletEntry.create({ data: { customerId, amount, kind: 'TopUp', note } }),
    ...(bonus > 0
      ? [db.walletEntry.create({ data: { customerId, amount: bonus, kind: 'Bonus', note: 'Top-up bonus' } })]
      : []),
    db.customer.update({ where: { id: customerId }, data: { walletBalance: { increment: amount + bonus } } }),
  ])
}

/** Pay for a service from the wallet. Amount is positive; stored as a negative entry. */
export async function spendWallet(customerId: string, amount: number, note?: string) {
  if (amount <= 0) return
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } })
  if (!c || c.walletBalance < amount) throw new Error('insufficient-wallet-balance')
  await db.$transaction([
    db.walletEntry.create({ data: { customerId, amount: -amount, kind: 'Spend', note } }),
    db.customer.update({ where: { id: customerId }, data: { walletBalance: { decrement: amount } } }),
  ])
}

/** Total unspent wallet value across all customers — a liability, not revenue. */
export async function walletLiability(): Promise<number> {
  const agg = await db.customer.aggregate({ _sum: { walletBalance: true } })
  return agg._sum.walletBalance ?? 0
}
