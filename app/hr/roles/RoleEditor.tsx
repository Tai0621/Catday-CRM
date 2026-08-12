'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ALL_TABS, ALWAYS_ALLOWED, PINNED, AI_LINKS, SEGMENTS, segmentOf } from '@/lib/nav-catalogue'
import { createRole, updateRole, deleteRole } from './actions'
import { OVERFLOW_GROUP, MAX_GROUPS, type NavLayout } from '@/lib/nav-layout'

const INK = '#2D1907'
const ACCENT = '#B14919'

export interface EditableRole {
  id: string
  key: string
  label: string
  homePath: string
  paths: string[]
  isSystem: boolean
  staffCount: number
  layout: NavLayout
}

// The tab picker, grouped exactly as the nav groups them. Presenting the
// permissions in a different shape from the sidebar the owner already knows
// would make them translate between two mental models to answer one question:
// "what will this person see?"
const GROUPS: { key: string; header: string; color: string; tabs: { href: string; label: string }[] }[] = [
  { key: 'pinned', header: 'Pinned', color: '#B14919', tabs: PINNED },
  { key: 'ai', header: 'AI', color: '#98A86B', tabs: AI_LINKS },
  ...SEGMENTS.map(s => ({
    key: s.key, header: s.header, color: s.color,
    tabs: s.groups.flatMap(g => g.links),
  })),
]

export function RoleEditor({ roles }: { roles: EditableRole[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm cd-muted">
          Each role sees only the tabs ticked for it. Changes apply the moment they are saved — including to
          anyone already signed in.
        </p>
        <button type="button" onClick={() => { setCreating(true); setEditing(null) }} className="cd-btn text-sm">
          + New role
        </button>
      </div>

      {creating && <RoleForm onClose={() => setCreating(false)} />}

      <div className="space-y-2">
        {roles.map(role => (
          <div key={role.id} className="cd-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: INK }}>{role.label}</span>
                  {role.isSystem && (
                    <span className="cd-pill text-xs" style={{ background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }}>
                      built in
                    </span>
                  )}
                </div>
                <p className="text-xs cd-muted mt-0.5">
                  {role.isSystem
                    ? 'Full access to everything — this is the owner’s own role.'
                    : `${role.paths.length} tab${role.paths.length === 1 ? '' : 's'} · lands on ${role.homePath}`}
                  {' · '}
                  {role.staffCount} staff
                </p>
              </div>
              {!role.isSystem && (
                <button type="button" onClick={() => { setEditing(editing === role.id ? null : role.id); setCreating(false) }}
                  className="text-xs cd-link shrink-0">
                  {editing === role.id ? 'Close' : 'Edit access'}
                </button>
              )}
            </div>

            {editing === role.id && <RoleForm role={role} onClose={() => setEditing(null)} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function RoleForm({ role, onClose }: { role?: EditableRole; onClose: () => void }) {
  const router = useRouter()
  const [label, setLabel] = useState(role?.label ?? '')
  const [picked, setPicked] = useState<string[]>(role?.paths ?? [])
  const [homePath, setHomePath] = useState(role?.homePath ?? '')
  const [layout, setLayout] = useState<NavLayout>(role?.layout ?? { pinned: [], groups: [] })
  const [newGroup, setNewGroup] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()

  // Un-ticking a tab also drops it out of the sidebar arrangement, so a group
  // cannot keep a link to something the role can no longer open.
  const toggle = (href: string) =>
    setPicked(prev => {
      const next = prev.includes(href) ? prev.filter(p => p !== href) : [...prev, href]
      if (!next.includes(href)) setLayout(l => strip(l, href))
      return next
    })

  const strip = (l: NavLayout, href: string): NavLayout => ({
    pinned: l.pinned.filter(p => p !== href),
    groups: l.groups.map(g => ({ ...g, paths: g.paths.filter(p => p !== href) })),
  })

  const placementOf = (href: string): string => {
    if (layout.pinned.includes(href)) return '__pinned'
    return layout.groups.find(g => g.paths.includes(href))?.label ?? ''
  }

  /** A tab lives in exactly one place, so moving it removes it from the others. */
  const place = (href: string, target: string) =>
    setLayout(l => {
      const base = strip(l, href)
      if (target === '__pinned') return { ...base, pinned: [...base.pinned, href] }
      if (!target) return base // unplaced — it will surface under the overflow group
      return { ...base, groups: base.groups.map(g => (g.label === target ? { ...g, paths: [...g.paths, href] } : g)) }
    })

  const addGroup = () => {
    const name = newGroup.trim()
    if (!name || layout.groups.some(g => g.label === name) || layout.groups.length >= MAX_GROUPS) return
    setLayout(l => ({ ...l, groups: [...l.groups, { label: name, paths: [] }] }))
    setNewGroup('')
  }

  // Its tabs are not revoked, only unfiled — they reappear under the overflow
  // group rather than vanishing from a sidebar they still have access to.
  const removeGroup = (label: string) =>
    setLayout(l => ({ ...l, groups: l.groups.filter(g => g.label !== label) }))

  // Only somewhere they can actually reach — a landing page outside the ticked
  // set would bounce them back to it on every login.
  const homeOptions = ALL_TABS.filter(t => picked.includes(t.href))

  function submit() {
    setError(null)
    const fd = new FormData()
    if (role) fd.append('id', role.id)
    fd.append('label', label)
    fd.append('homePath', homePath || picked[0] || '')
    for (const p of picked) fd.append('paths', p)
    fd.append('layout', JSON.stringify(layout))
    startBusy(async () => {
      const res = role ? await updateRole(fd) : await createRole(fd)
      if (res.ok) { onClose(); router.refresh() }
      else setError(res.error)
    })
  }

  function remove() {
    if (!role) return
    setError(null)
    const fd = new FormData()
    fd.append('id', role.id)
    startBusy(async () => {
      const res = await deleteRole(fd)
      if (res.ok) { onClose(); router.refresh() }
      else setError(res.error)
    })
  }

  return (
    <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid rgba(45,25,7,0.12)' }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="cd-label">Role name *</label>
          <input value={label} onChange={e => setLabel(e.target.value)} className="cd-input"
            placeholder="e.g. Senior Groomer" />
        </div>
        <div>
          <label className="cd-label">Lands on</label>
          <select value={homePath} onChange={e => setHomePath(e.target.value)} className="cd-input"
            disabled={homeOptions.length === 0}>
            <option value="">{homeOptions.length === 0 ? 'Tick a tab first' : 'First ticked tab'}</option>
            {homeOptions.map(t => <option key={t.href} value={t.href}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <p className="text-xs cd-muted">
        <strong>Clock In / Out</strong> and <strong>My Leave</strong> are always available to every role —
        a role that could not start a shift would look like a broken app rather than a choice.
      </p>

      <div className="space-y-3">
        {GROUPS.map(g => (
          <div key={g.key}>
            <div className="text-[11px] font-semibold uppercase mb-1.5"
              style={{ color: g.color, letterSpacing: '0.08em' }}>{g.header}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.tabs.map(t => {
                const on = picked.includes(t.href)
                return (
                  <button key={t.href} type="button" onClick={() => toggle(t.href)}
                    className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    style={on
                      ? { background: ACCENT, color: '#F2EDE0', border: `1px solid ${ACCENT}` }
                      : { background: '#F2EDE0', color: 'rgba(45,25,7,0.6)', border: '1px solid rgba(45,25,7,0.15)' }}>
                    {on ? '✓ ' : ''}{t.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {picked.length > 0 && (
        <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(114,144,148,0.10)', border: '1px solid rgba(114,144,148,0.28)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: INK }}>Their sidebar</div>
            <p className="text-xs cd-muted">
              Pinned tabs sit at the top, always visible. Everything else goes into a drop-down you name.
              Anything you leave unplaced still shows, under <strong>{OVERFLOW_GROUP}</strong> — a tab they
              can open should never be one they cannot find.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {layout.groups.map(g => (
              <span key={g.label} className="text-xs px-2 py-1 rounded-lg inline-flex items-center gap-1.5"
                style={{ background: '#F2EDE0', border: '1px solid rgba(45,25,7,0.15)', color: INK }}>
                {g.label}
                <button type="button" onClick={() => removeGroup(g.label)} style={{ color: ACCENT }} aria-label={`Remove ${g.label}`}>×</button>
              </span>
            ))}
            {layout.groups.length < MAX_GROUPS && (
              <span className="inline-flex gap-1">
                <input value={newGroup} onChange={e => setNewGroup(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGroup() } }}
                  placeholder="New drop-down…" className="cd-input text-xs" style={{ width: '9rem', padding: '0.25rem 0.5rem' }} />
                <button type="button" onClick={addGroup} className="cd-btn-sec text-xs">Add</button>
              </span>
            )}
          </div>

          <div className="space-y-1">
            {ALL_TABS.filter(t => picked.includes(t.href)).map(t => (
              <div key={t.href} className="flex items-center gap-2">
                <span className="text-xs flex-1 truncate" style={{ color: INK }}>{t.label}</span>
                <select value={placementOf(t.href)} onChange={e => place(t.href, e.target.value)}
                  className="cd-input text-xs" style={{ width: 'auto', padding: '0.2rem 0.4rem' }}>
                  <option value="">{OVERFLOW_GROUP}</option>
                  <option value="__pinned">Pinned</option>
                  {layout.groups.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'rgba(177,73,25,0.12)', color: ACCENT }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={busy || !label.trim() || picked.length === 0}
          className="cd-btn text-sm"
          style={busy || !label.trim() || picked.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Saving…' : role ? 'Save access' : 'Create role'}
        </button>
        <button type="button" onClick={onClose} className="cd-btn-sec text-sm">Cancel</button>
        {role && (
          <button type="button" onClick={remove} disabled={busy}
            className="text-xs ml-auto" style={{ color: ACCENT }}>
            Delete role
          </button>
        )}
      </div>
    </div>
  )
}

/** Re-exported so the page can group without duplicating the mapping. */
export { segmentOf }
