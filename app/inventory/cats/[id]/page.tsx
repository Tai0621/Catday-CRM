import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { saleGate, ageLabel, lifeStageFor, desexLabel, costToDate, NOT_HOUSE } from '@/lib/cat-stock'
import {
  CAT_STOCK_ROLES, CAT_STOCK_ROLE_HINTS, CAT_STOCK_STATUS_LABELS, CAT_COST_CATEGORIES,
  RESIDENCY_TYPE,
} from '@/lib/constants'
import {
  updateStock, reserveCat, releaseReservation, exitCat, undoExit,
  addCost, deleteCost, assignRoom, setLitter,
} from '../actions'

const rm = (n: number | null | undefined) => (n == null ? '—' : `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`)
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

export default async function CatStockPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await requireManager()
  const { id } = await params
  const { error } = await searchParams

  const stock = await db.catStock.findUnique({
    where: { id },
    include: {
      cat: true,
      costs: { orderBy: { date: 'desc' } },
      litter: { select: { id: true, code: true } },
    },
  })
  if (!stock) notFound()

  const now = new Date()
  const gate = saleGate(stock, now)
  const spent = costToDate(stock, stock.costs)

  const [residency, rooms, customers, litters, reservedFor] = await Promise.all([
    db.appointment.findFirst({
      where: { catId: stock.catId, type: RESIDENCY_TYPE, status: 'CheckedIn' },
      select: { id: true, roomId: true, room: { select: { name: true } }, scheduledAt: true },
    }),
    db.room.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    db.customer.findMany({ where: NOT_HOUSE, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' }, take: 500 }),
    db.litter.findMany({ select: { id: true, code: true }, orderBy: { code: 'desc' }, take: 50 }),
    stock.reservedForId
      ? db.customer.findUnique({ where: { id: stock.reservedForId }, select: { name: true, phone: true } })
      : Promise.resolve(null),
  ])

  const gone = stock.status === 'Sold' || stock.status === 'Rehomed' || stock.status === 'Deceased'

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <Link href="/inventory/cats" className="text-xs cd-muted hover:underline">← Cat Inventory</Link>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{stock.cat.name}</h1>
          <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>{stock.sku}</span>
          <span className="cd-pill" style={{ background: 'rgba(114,144,148,0.18)', color: '#2D1907' }}>
            {CAT_STOCK_STATUS_LABELS[stock.status] ?? stock.status}
          </span>
        </div>
        <p className="text-sm cd-muted mt-1">
          {[stock.cat.breed, stock.cat.gender, desexLabel(stock.cat.gender, stock.cat.desexedAt),
            ageLabel(stock.cat.dateOfBirth, now), lifeStageFor(stock.cat.dateOfBirth, null, now)]
            .filter(Boolean).join(' · ')}
          {' · '}
          <Link href={`/cats/${stock.catId}`} className="cd-link">Animal record →</Link>
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.25)' }}>
          {error}
        </div>
      )}

      {/* Readiness — the question the page exists to answer */}
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Can this cat be sold?</h2>
          {gate.ready
            ? <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.2)', color: '#4a5530' }}>Ready</span>
            : <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>Not yet</span>}
        </div>
        {gate.blockers.length > 0 && (
          <ul className="text-sm space-y-0.5" style={{ color: '#B14919' }}>
            {gate.blockers.map(b => <li key={b}>· {b}</li>)}
          </ul>
        )}
        {gate.warnings.length > 0 && (
          <ul className="text-sm space-y-0.5 cd-muted mt-1">
            {gate.warnings.map(w => <li key={w}>· {w} <span className="text-xs">(tell the buyer)</span></li>)}
          </ul>
        )}
        {gate.ready && gate.warnings.length === 0 && <p className="text-sm cd-muted">Nothing outstanding.</p>}
        {gate.ready && !gone && (
          <Link href={`/pos?catStock=${stock.id}`} className="cd-btn inline-block mt-3">Sell in POS</Link>
        )}
      </div>

      {/* Money */}
      <div className="grid md:grid-cols-3 gap-3">
        <Stat label="Acquisition cost" value={rm(stock.acquisitionRM)} hint="What the balance sheet carries" />
        <Stat label="Spent to date" value={rm(spent)} hint="Acquisition + vet, for pricing only" />
        <Stat label="Asking price" value={rm(stock.askingRM)} hint={stock.askingRM ? `Margin ${rm(stock.askingRM - spent)}` : 'Not set'} />
      </div>

      {/* Commercial details */}
      <form action={updateStock} className="cd-card p-4 grid md:grid-cols-3 gap-3">
        <input type="hidden" name="id" value={stock.id} />
        <h2 className="md:col-span-3 font-semibold" style={{ color: '#2D1907' }}>Stock details</h2>
        <div>
          <label className="cd-label">Role</label>
          <select name="role" defaultValue={stock.role} className="cd-input">
            {CAT_STOCK_ROLES.map(r => <option key={r} value={r}>{r} — {CAT_STOCK_ROLE_HINTS[r]}</option>)}
          </select>
        </div>
        <div><label className="cd-label">Asking price (RM)</label><input name="askingRM" type="number" min="0" step="1" defaultValue={stock.askingRM ?? ''} className="cd-input" /></div>
        <div><label className="cd-label">Acquisition cost (RM)</label><input name="acquisitionRM" type="number" min="0" step="1" defaultValue={stock.acquisitionRM} className="cd-input" /></div>
        <div><label className="cd-label">Acquired from</label><input name="acquiredFrom" defaultValue={stock.acquiredFrom ?? ''} className="cd-input" /></div>
        <div><label className="cd-label">Microchip no.</label><input name="microchipNo" defaultValue={stock.microchipNo ?? ''} className="cd-input" /></div>
        <div><label className="cd-label">Registration no.</label><input name="registrationNo" defaultValue={stock.registrationNo ?? ''} className="cd-input" /></div>
        <div className="md:col-span-3"><label className="cd-label">Notes</label><input name="notes" defaultValue={stock.notes ?? ''} className="cd-input" /></div>
        <div className="md:col-span-3"><button type="submit" className="cd-btn-sec">Save</button></div>
      </form>

      {/* Where it lives */}
      <div className="cd-card p-4 space-y-2">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Room</h2>
        <p className="text-sm cd-muted">
          {residency?.room
            ? `In ${residency.room.name} since ${day(residency.scheduledAt)}. The room shows as occupied, and the run sheet raises this cat's daily care tasks.`
            : 'Not assigned to a room. Assign one and the cat joins the run sheet.'}
        </p>
        <form action={assignRoom} className="flex items-end gap-2">
          <input type="hidden" name="id" value={stock.id} />
          <div>
            <label className="cd-label">Room</label>
            <select name="roomId" defaultValue={residency?.roomId ?? ''} className="cd-input" style={{ width: 'auto' }}>
              <option value="">— none —</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button type="submit" className="cd-btn-sec">Set room</button>
        </form>
      </div>

      {/* Reservation */}
      {!gone && (
        <div className="cd-card p-4 space-y-2">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Reservation</h2>
          {stock.status === 'Reserved' ? (
            <>
              <p className="text-sm">
                Held for <strong>{reservedFor?.name ?? reservedFor?.phone ?? 'a customer'}</strong>
                {stock.depositRM ? ` · deposit ${rm(stock.depositRM)}` : ''}
                {stock.reservedUntil ? ` · until ${day(stock.reservedUntil)}` : ''}
              </p>
              <p className="text-xs cd-muted">
                A deposit is not revenue until the cat leaves — it is recorded here, not in the books.
              </p>
              <form action={releaseReservation}>
                <input type="hidden" name="id" value={stock.id} />
                <button type="submit" className="cd-btn-sec">Release hold</button>
              </form>
            </>
          ) : (
            <form action={reserveCat} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={stock.id} />
              <div>
                <label className="cd-label">Held for</label>
                <select name="reservedForId" className="cd-input" style={{ width: '12rem' }}>
                  <option value="">— choose —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
                </select>
              </div>
              <div><label className="cd-label">Deposit (RM)</label><input name="depositRM" type="number" min="0" step="1" className="cd-input" style={{ width: '6rem' }} /></div>
              <div><label className="cd-label">Until</label><input name="reservedUntil" type="date" className="cd-input" style={{ width: 'auto' }} /></div>
              <button type="submit" className="cd-btn-sec">Reserve</button>
            </form>
          )}
        </div>
      )}

      {/* Cost ledger */}
      <div className="cd-card p-4 space-y-3">
        <div>
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Cost ledger</h2>
          <p className="text-xs cd-muted">
            What this cat has cost, for setting a price. These are expensed in the month they are paid —
            recording them here does not put them on the balance sheet.
          </p>
        </div>
        {stock.costs.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="cd-thead"><th>Date</th><th>Category</th><th>Vendor</th><th>Amount</th><th></th></tr></thead>
            <tbody className="cd-tbody">
              {stock.costs.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-2 cd-muted whitespace-nowrap">{day(c.date)}</td>
                  <td className="px-4 py-2">{c.category}{c.batchId && <span className="cd-muted text-xs"> · batch</span>}</td>
                  <td className="px-4 py-2 cd-muted">{c.vendor ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{rm(c.amountRM)}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={deleteCost}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="text-xs cd-link">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addCost} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="catStockId" value={stock.id} />
          <div><label className="cd-label">Date</label><input name="date" type="date" defaultValue={day(now)} className="cd-input" style={{ width: 'auto' }} /></div>
          <div>
            <label className="cd-label">Category</label>
            <select name="category" className="cd-input" style={{ width: 'auto' }}>
              {CAT_COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="cd-label">Amount (RM)</label><input name="amountRM" type="number" min="0" step="0.5" className="cd-input" style={{ width: '6rem' }} /></div>
          <div><label className="cd-label">Vendor</label><input name="vendor" className="cd-input" style={{ width: '9rem' }} /></div>
          <button type="submit" className="cd-btn-sec">Add cost</button>
        </form>
      </div>

      {/* Litter */}
      <form action={setLitter} className="cd-card p-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={stock.id} />
        <div>
          <label className="cd-label">Litter</label>
          <select name="litterId" defaultValue={stock.litterId ?? ''} className="cd-input" style={{ width: 'auto' }}>
            <option value="">— none —</option>
            {litters.map(l => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
        </div>
        <button type="submit" className="cd-btn-sec">Save litter</button>
        <Link href="/inventory/litters" className="cd-link text-sm pb-2">Manage litters →</Link>
      </form>

      {/* Exit */}
      <div className="cd-card p-4 space-y-2" style={{ borderColor: 'rgba(177,73,25,0.25)' }}>
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Leaving</h2>
        {gone ? (
          <>
            <p className="text-sm">
              {CAT_STOCK_STATUS_LABELS[stock.status]}{stock.exitAt ? ` on ${day(stock.exitAt)}` : ''}
              {stock.exitReason ? ` — ${stock.exitReason}` : ''}
              {stock.soldAt ? ` · sold ${day(stock.soldAt)} for ${rm(stock.saleRM)}` : ''}
            </p>
            {stock.status !== 'Sold' && (
              <form action={undoExit}>
                <input type="hidden" name="id" value={stock.id} />
                <button type="submit" className="cd-btn-sec">Undo — return to stock</button>
              </form>
            )}
            {stock.status === 'Sold' && (
              <p className="text-xs cd-muted">Sold through the POS. To correct it, delete that sale in Revenue — the cat returns to stock.</p>
            )}
          </>
        ) : (
          <>
            <p className="text-xs cd-muted">
              Rehoming and deaths are recorded, never deleted — a death is a welfare record and a write-off,
              and both are things the business may be asked about later.
            </p>
            <form action={exitCat} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={stock.id} />
              <div>
                <label className="cd-label">Outcome</label>
                <select name="status" className="cd-input" style={{ width: 'auto' }}>
                  <option value="Rehomed">Rehomed</option>
                  <option value="Deceased">Deceased</option>
                </select>
              </div>
              <div><label className="cd-label">Date</label><input name="exitAt" type="date" defaultValue={day(now)} className="cd-input" style={{ width: 'auto' }} /></div>
              <div>
                <label className="cd-label">New owner (rehoming)</label>
                <select name="toCustomerId" className="cd-input" style={{ width: '11rem' }}>
                  <option value="">— none —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
                </select>
              </div>
              <div><label className="cd-label">Fee (RM)</label><input name="saleRM" type="number" min="0" step="1" className="cd-input" style={{ width: '5.5rem' }} /></div>
              <div className="flex-1" style={{ minWidth: '10rem' }}><label className="cd-label">Reason</label><input name="exitReason" className="cd-input" /></div>
              <button type="submit" className="cd-btn-sec">Record</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold" style={{ color: '#2D1907' }}>{value}</div>
      {hint && <div className="text-xs cd-muted mt-0.5">{hint}</div>}
    </div>
  )
}
