import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { INCIDENT_TYPES } from '@/lib/constants'

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireAuth()
  const { show } = await searchParams
  const includeResolved = show === 'all'

  const incidents = await db.incident.findMany({
    where: includeResolved ? {} : { resolved: false },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  async function create(data: FormData) {
    'use server'
    await db.incident.create({
      data: {
        type: (data.get('type') as string) || 'Complaint',
        description: data.get('description') as string,
      },
    })
    redirect('/incidents')
  }

  async function toggleResolved(data: FormData) {
    'use server'
    const id = data.get('id') as string
    const resolved = data.get('resolved') === 'true'
    await db.incident.update({ where: { id }, data: { resolved: !resolved } })
    redirect('/incidents')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Incidents &amp; Complaints</h1>
          <p className="text-sm cd-muted">Log safety incidents and customer complaints for the operations dashboard</p>
        </div>
        <a href={includeResolved ? '/incidents' : '/incidents?show=all'} className="cd-btn-sec text-sm">
          {includeResolved ? 'Show open only' : 'Show all'}
        </a>
      </div>

      <div className="cd-card p-5">
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Log New</h2>
        <form action={create} className="flex flex-col sm:flex-row gap-2">
          <select name="type" className="cd-input" style={{ maxWidth: '10rem' }}>
            {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input name="description" required placeholder="What happened?" className="cd-input flex-1" />
          <button type="submit" className="cd-btn whitespace-nowrap">Log</button>
        </form>
      </div>

      <div className="cd-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="cd-thead">
            <th>Date</th>
            <th>Type</th>
            <th>Description</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody className="cd-tbody">
            {incidents.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center cd-muted">No {includeResolved ? '' : 'open '}incidents</td></tr>
            )}
            {incidents.map(i => (
              <tr key={i.id} style={i.resolved ? { opacity: 0.6 } : undefined}>
                <td className="px-4 py-3 cd-muted whitespace-nowrap">{i.createdAt.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-3">
                  <span className="cd-pill" style={i.type === 'Safety'
                    ? { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
                    : { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' }}>{i.type}</span>
                </td>
                <td className="px-4 py-3" style={{ color: '#2D1907' }}>{i.description}</td>
                <td className="px-4 py-3">
                  <span className="cd-pill" style={i.resolved
                    ? { background: 'rgba(114,144,148,0.2)', color: '#729094' }
                    : { background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>
                    {i.resolved ? 'Resolved' : 'Open'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <form action={toggleResolved}>
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="resolved" value={String(i.resolved)} />
                    <button type="submit" className="text-xs cd-link">{i.resolved ? 'Reopen' : 'Resolve'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
