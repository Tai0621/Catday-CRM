import { db } from './db'

export const STOCK_REASONS = ['Sale', 'SaleReversal', 'Restock', 'Adjustment', 'Wastage', 'InitialStock', 'Return', 'HouseUse'] as const
export type StockReason = typeof STOCK_REASONS[number]

export const STOCK_REASON_LABELS: Record<string, string> = {
  Sale: 'Sale',
  SaleReversal: 'Sale reversed',
  Restock: 'Received',
  Adjustment: 'Adjustment',
  Wastage: 'Wastage / damage',
  InitialStock: 'Opening stock',
  Return: 'Customer return',
  HouseUse: 'Used by the cattery',
}

// Manual stock movement: writes the ledger row AND moves the cached balance in
// one transaction (the ledger+balance rule). POS sale/reversal write their own
// movements inline in their existing atomic batches; this is for manual ops
// (receive / adjust / wastage). Never call with delta 0.
export async function recordStockMovement(
  productId: string,
  delta: number,
  reason: StockReason,
  opts?: { reference?: string | null; note?: string | null; staffId?: string | null },
): Promise<void> {
  if (delta === 0) return
  await db.$transaction([
    db.stockMovement.create({
      data: { productId, delta, reason, reference: opts?.reference ?? null, note: opts?.note ?? null, staffId: opts?.staffId ?? null },
    }),
    db.product.update({ where: { id: productId }, data: { stockQty: { increment: delta } } }),
  ])
}

export function isLow(stockQty: number, reorderLevel: number | null): boolean {
  return reorderLevel != null && stockQty <= reorderLevel
}

/**
 * What the cattery consumed from retail stock in a window, at cost.
 *
 * This is how livestock feed is costed, and it is deliberately NOT a per-cat
 * allocation. Sixty-odd cats share bowls; per-cat grams is a number the system
 * would have to invent, and an invented figure that looks precise gets used to
 * price an animal. Divide this by head count for a defensible cost per cat.
 */
export async function houseUseCost(from: Date, to: Date): Promise<number> {
  const moves = await db.stockMovement.findMany({
    where: { reason: 'HouseUse', createdAt: { gte: from, lt: to } },
    select: { delta: true, product: { select: { costPrice: true } } },
  })
  const total = moves.reduce((s, m) => s + Math.abs(m.delta) * (m.product?.costPrice ?? 0), 0)
  return Math.round(total * 100) / 100
}

// Prisma can't compare two columns in `where`, so filter in memory (the catalog
// is small). Sorted most-urgent first (furthest below its reorder level).
export async function lowStockProducts() {
  const ps = await db.product.findMany({
    where: { active: true, reorderLevel: { not: null } },
    select: { id: true, name: true, stockQty: true, reorderLevel: true },
  })
  return ps
    .filter(p => p.stockQty <= (p.reorderLevel ?? 0))
    .sort((a, b) => (a.stockQty - (a.reorderLevel ?? 0)) - (b.stockQty - (b.reorderLevel ?? 0)))
}
