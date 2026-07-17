// Instant route-transition feedback — shows the moment you click a nav link,
// while the server renders the page.
export default function Loading() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
      <div className="text-center space-y-3">
        <div className="mx-auto rounded-full animate-spin"
          style={{
            width: 34, height: 34,
            border: '3px solid rgba(45,25,7,0.12)',
            borderTopColor: '#B14919',
          }} />
        <p className="text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-brand)', color: 'rgba(45,25,7,0.4)', letterSpacing: '0.15em' }}>
          cat day
        </p>
      </div>
    </div>
  )
}
