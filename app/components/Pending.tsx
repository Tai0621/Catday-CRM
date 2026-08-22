'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

// Acknowledging the click.
//
// Every button in this OS is a server action: it writes, then revalidatePath
// re-renders the whole page and ships it back. The write is the cheap half —
// ticking one care task costs 2 queries to save it and 12 to redraw the page
// around it (scripts/perf-action.mjs). Those queries do not overlap, because
// the libsql adapter takes a mutex per statement, so the person waits through
// all of them.
//
// Until that response lands the page is unchanged, so a button that was pressed
// looks exactly like a button that was not. The reflex is to press it again —
// which on the service board really does advance the appointment twice.
//
// So these components do two things: say the click landed, and refuse the
// second one. Neither makes the server faster; both are why it stops feeling
// slow.

/**
 * A submit button that shows it is working and cannot be pressed twice.
 *
 * `name`/`value` are passed through because a great many forms here are a ROW
 * of submit buttons that differ only by the value they post — the room state
 * control (Ready / Cleaning / Out of service), the statement period picker.
 * Without them those forms cannot use this component at all, which is most of
 * why the rollout stalled at four files.
 *
 * `disabled` is separate from `pending`: a button can be off because it is
 * already the current state, which is not the same as off because a save is in
 * flight, and they should not look identical.
 */
export function SubmitButton({
  children, busyLabel, className, style, name, value, disabled, title, 'aria-label': ariaLabel,
}: {
  children: React.ReactNode
  busyLabel?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  name?: string
  value?: string
  disabled?: boolean
  title?: string
  'aria-label'?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled || pending}
      title={title}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      className={className}
      style={{ ...style, ...(pending && !disabled ? { opacity: 0.6, cursor: 'progress' } : null) }}>
      {pending && !disabled ? (busyLabel ?? children) : children}
    </button>
  )
}

/**
 * The run sheet's tick box.
 *
 * It fills in the moment it is pressed rather than a second later when the
 * server agrees. If the save fails the re-render puts it back — the checkbox
 * follows the database, it just stops pretending it has no opinion in the
 * meantime.
 */
export function TaskCheck({ done, color }: { done: boolean; color: string }) {
  const { pending } = useFormStatus()
  const filled = pending ? !done : done
  return (
    <button type="submit" disabled={pending} aria-pressed={filled}
      className="rounded-md flex items-center justify-center text-xs font-bold shrink-0"
      style={{
        width: 22, height: 22,
        background: filled ? color : 'transparent',
        color: filled ? '#F2EDE0' : 'transparent',
        border: `1.5px solid ${filled ? color : 'rgba(45,25,7,0.25)'}`,
        cursor: pending ? 'progress' : 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}>
      ✓
    </button>
  )
}

/**
 * Says out loud that a save finished.
 *
 * There are no `aria-live` regions anywhere in this OS, which means every
 * state change is communicated by the page silently redrawing. A sighted user
 * infers it from the row changing; a screen-reader user gets nothing at all,
 * and anyone glancing away misses it entirely.
 *
 * Deliberately announces only what it KNOWS. It watches this form's own
 * pending flag go true then false, so the honest claim is "the save finished",
 * not "the save succeeded" — the component cannot see the result, and an
 * action that redirected with an error would make a success message a lie.
 * Where a page needs to report an outcome it should render it from its own
 * state, which several already do via `?error=`.
 *
 * Drop inside any <form action={...}> and it announces on completion.
 */
export function SavedAnnouncer({ label = 'Saved' }: { label?: string }) {
  const { pending } = useFormStatus()
  const was = useRef(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (pending) { was.current = true; return }
    if (!was.current) return
    was.current = false
    setMessage(label)
    // Cleared so a later identical announcement is re-read rather than being
    // treated as unchanged text and skipped.
    const t = setTimeout(() => setMessage(''), 3000)
    return () => clearTimeout(t)
  }, [pending, label])

  return (
    <span role="status" aria-live="polite" className="sr-only">{message}</span>
  )
}

/**
 * A submit button that asks first.
 *
 * There are 35 destructive actions in the OS and five of them confirmed
 * anything. The unguarded ones included deleting an expense (which feeds the
 * income statement), a fixed asset (the balance sheet) and a whole cabinet bank
 * (which unplaces every room in it) — each one click, no question, no undo.
 *
 * `confirm()` rather than a modal system because three places already use it
 * and one blocking dialog everybody recognises beats a second vocabulary. The
 * honest limitation: with JavaScript off the form still submits, so this is a
 * guard against the accidental click, not an authorisation check. Anything that
 * must not happen has to be refused on the SERVER — as deleting a room with
 * bookings and narrowing a system role already are.
 */
export function ConfirmSubmit({
  message, children, busyLabel, className, style, name, value,
}: {
  /** Say what will be destroyed, specifically. "Are you sure?" tells nobody anything. */
  message: string
  children: React.ReactNode
  busyLabel?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={e => { if (!window.confirm(message)) e.preventDefault() }}
      className={className}
      style={{ ...style, ...(pending ? { opacity: 0.6, cursor: 'progress' } : null) }}>
      {pending ? (busyLabel ?? children) : children}
    </button>
  )
}
