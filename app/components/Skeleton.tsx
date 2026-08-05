// Loading placeholders that mirror the shape of the page being fetched.
//
// The point of a skeleton over a spinner is that the layout does not jump when
// the real content lands: the header sits where the header will sit, the cards
// occupy the space cards will occupy. That means these primitives are used to
// compose a *specific* page's outline, not as a generic grey box.
//
// All server components — a loading state that ships client JS defeats itself.

export function SkeletonLine({ w = '100%', h = 12 }: { w?: string | number; h?: number }) {
  return <div className="cd-skeleton" style={{ width: w, height: h }} aria-hidden />
}

export function SkeletonBlock({ w = '100%', h = 80, radius = 8 }: { w?: string | number; h?: number; radius?: number }) {
  return <div className="cd-skeleton" style={{ width: w, height: h, borderRadius: radius }} aria-hidden />
}

/**
 * Page heading + optional action button, matching the `h1` + button row every
 * list page opens with.
 */
export function SkeletonHeader({ action = true }: { action?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <SkeletonLine w={180} h={22} />
      {action && <SkeletonBlock w={110} h={34} radius={10} />}
    </div>
  )
}

/** The search / filter row that sits under most list headings. */
export function SkeletonFilters() {
  return (
    <div className="flex gap-2">
      <SkeletonBlock w="100%" h={38} radius={10} />
      <SkeletonBlock w={96} h={38} radius={10} />
    </div>
  )
}

/** Card grid — cats, customers, any tile list. */
export function SkeletonCardGrid({ count = 6, media = false }: { count?: number; media?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="cd-card p-4 flex items-start gap-3">
          {media && <SkeletonBlock w={88} h={88} radius={8} />}
          <div className="flex-1 space-y-2">
            <SkeletonLine w="60%" h={14} />
            <SkeletonLine w="85%" h={10} />
            <SkeletonLine w="45%" h={10} />
            <SkeletonLine w="55%" h={10} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Table shell — the `cd-card` + `cd-thead` pattern used across list pages. */
export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="cd-card overflow-hidden">
      <div className="cd-thead flex items-center gap-4 px-4 py-2.5">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="flex-1"><SkeletonLine w="70%" h={9} /></div>
        ))}
      </div>
      <div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3"
            style={{ borderTop: '1px solid rgba(45,25,7,0.07)' }}>
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} className="flex-1">
                <SkeletonLine w={c === 0 ? '80%' : `${45 + ((r + c) % 4) * 12}%`} h={11} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Stacked rows of cards — the Action Inbox and similar queues. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="cd-card p-4 flex items-center gap-3"
          style={{ borderLeft: '3px solid rgba(45,25,7,0.1)' }}>
          <div className="flex-1 space-y-2">
            <SkeletonLine w={`${55 + (i % 3) * 12}%`} h={13} />
            <SkeletonLine w={`${35 + (i % 4) * 10}%`} h={10} />
          </div>
          <SkeletonBlock w={84} h={28} radius={8} />
          <SkeletonBlock w={64} h={28} radius={8} />
        </div>
      ))}
    </div>
  )
}
