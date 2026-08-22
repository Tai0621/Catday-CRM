'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Cmd/Ctrl-K — jump anywhere.
//
// The OS has 83 pages behind 56 nav links in eight collapsible groups, so the
// thing you want is usually inside a drop-down whose name you have to remember
// first. This makes the hierarchy optional rather than mandatory: three letters
// and Enter. It deliberately does NOT restructure the nav — the six segments are
// the owner's mental model of the business, not an arbitrary menu.
//
// It searches DATA as well as pages (a customer, a cat, a room, a product), and
// every result says which part of the OS it came from.
//
// What comes back is decided entirely on the server — see lib/search.ts. This
// component never filters for access, because a client-side filter on data the
// server already sent is not access control, it is a curtain.

interface Item { id: string; title: string; subtitle?: string; href: string }
interface Group { key: string; label: string; section?: string; items: Item[] }

const INK = '#2D1907'
const RUST = '#B14919'

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // One flat list behind the grouped display, so the arrow keys move through
  // what the eye sees rather than through a nested structure.
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      // Defer to the paint so the field exists before focus is asked for.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    setQ('')
    setGroups([])
    setCursor(0)
  }, [open])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setGroups([]); setBusy(false); return }

    // Debounced, and every in-flight request is abandoned when the next
    // keystroke lands — otherwise a slow early query can overwrite the results
    // of a later, more specific one.
    const controller = new AbortController()
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json()
        setGroups(body.groups ?? [])
        setCursor(0)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setGroups([])
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, 150)

    return () => { clearTimeout(timer); controller.abort() }
  }, [q])

  const go = useCallback((href: string) => {
    setOpen(false)
    router.push(href)
  }, [router])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); go(flat[cursor].href) }
  }

  // Keep the highlighted row in view when the arrows run past the fold.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const term = q.trim()
  let index = -1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(45,25,7,0.35)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '10vh 1rem 1rem',
      }}>
      <div
        onKeyDown={onKeyDown}
        style={{
          width: '100%', maxWidth: 560, background: '#FDFBF5',
          border: '1px solid rgba(45,25,7,0.18)', borderRadius: 14,
          boxShadow: '0 24px 60px rgba(45,25,7,0.28)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '70vh',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.85rem 1rem', borderBottom: '1px solid rgba(45,25,7,0.1)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.7}
            strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search pages, customers, cats, rooms…"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: '0.95rem', color: INK,
            }} />
          <kbd style={{
            fontSize: '0.65rem', padding: '2px 6px', borderRadius: 5, color: 'rgba(45,25,7,0.45)',
            border: '1px solid rgba(45,25,7,0.16)', fontFamily: 'var(--font-brand)', flexShrink: 0,
          }}>ESC</kbd>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', padding: '0.4rem 0' }}>
          {term.length < 2 ? (
            <p style={{ padding: '1.4rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'rgba(45,25,7,0.45)' }}>
              Type at least two letters. Pages, customers, cats, rooms and products.
            </p>
          ) : busy && groups.length === 0 ? (
            <p style={{ padding: '1.4rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'rgba(45,25,7,0.45)' }}>
              Searching…
            </p>
          ) : groups.length === 0 ? (
            <p style={{ padding: '1.4rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'rgba(45,25,7,0.45)' }}>
              Nothing matches “{term}”.
            </p>
          ) : (
            groups.map(g => (
              <div key={g.key}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 6,
                  padding: '0.5rem 1rem 0.25rem', fontSize: '0.62rem',
                  textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(45,25,7,0.4)',
                }}>
                  <span style={{ fontWeight: 700 }}>{g.label}</span>
                  {/* Where in the OS this came from — asked for explicitly, and
                      it is what makes a bare name like "Milo" legible. */}
                  {g.section && <span style={{ opacity: 0.7 }}>· {g.section}</span>}
                </div>
                {g.items.map(item => {
                  index++
                  const active = index === cursor
                  const at = index
                  return (
                    <button
                      key={`${g.key}:${item.id}`}
                      data-active={active}
                      onMouseEnter={() => setCursor(at)}
                      onClick={() => go(item.href)}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'baseline', gap: 8,
                        padding: '0.5rem 1rem', textAlign: 'left', border: 'none', cursor: 'pointer',
                        background: active ? 'rgba(177,73,25,0.1)' : 'transparent',
                        borderLeft: `2px solid ${active ? RUST : 'transparent'}`,
                      }}>
                      <span style={{ fontSize: '0.87rem', color: INK, fontWeight: active ? 600 : 400 }}>
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span style={{ fontSize: '0.72rem', color: 'rgba(45,25,7,0.45)' }}>{item.subtitle}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div style={{
          display: 'flex', gap: 14, padding: '0.5rem 1rem', borderTop: '1px solid rgba(45,25,7,0.1)',
          fontSize: '0.65rem', color: 'rgba(45,25,7,0.42)',
        }}>
          <span>↑↓ move</span><span>↵ open</span><span style={{ marginLeft: 'auto' }}>You only see what you can open</span>
        </div>
      </div>
    </div>
  )
}
