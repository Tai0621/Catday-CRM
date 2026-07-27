import { db } from './db'
import { getSession, type Session } from './auth'
import { headers } from 'next/headers'

// Append-only audit trail. recordAudit() is best-effort: it must NEVER throw
// back into the caller — a failed audit write can't be allowed to roll back or
// break the real operation it's recording. Call it from inside a server action,
// after the mutation succeeds. Pass the session if you already have it.

type AuditInput = {
  action: string       // dotted verb, e.g. 'transaction.delete'
  entityType: string
  entityId?: string | null
  summary: string      // human-readable one-liner shown in the log
  detail?: unknown     // optional structured context, JSON-stringified
}

export async function recordAudit(input: AuditInput, session?: Session | null): Promise<void> {
  try {
    const s = session ?? (await getSession())
    let ip: string | null = null
    try {
      ip = (await headers()).get('x-forwarded-for')?.split(',')[0].trim() || null
    } catch {
      // headers() unavailable in this context — fine, IP is optional
    }
    await db.auditLog.create({
      data: {
        actorKind: s?.kind ?? 'system',
        actorId: s?.kind === 'staff' ? s.staffId : null,
        actorName: s?.name ?? 'Unknown',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        detail: input.detail === undefined ? null : JSON.stringify(input.detail),
        ip,
      },
    })
  } catch (e) {
    console.error('audit write failed:', e)
  }
}

export async function listAudit(limit = 200) {
  return db.auditLog.findMany({ orderBy: { at: 'desc' }, take: limit })
}
