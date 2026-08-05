import { SkeletonLine, SkeletonBlock, SkeletonRows } from '../components/Skeleton'

// The Action Inbox is a segment-filter row above banded queues of cards, so it
// gets its own outline rather than the table fallback.
export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" role="status" aria-busy="true" aria-label="Loading actions">
      <div className="space-y-2">
        <SkeletonLine w={150} h={20} />
        <SkeletonLine w="55%" h={11} />
      </div>

      {/* segment filter pills */}
      <div className="flex flex-wrap gap-2">
        {[68, 92, 84, 76, 88].map((w, i) => <SkeletonBlock key={i} w={w} h={24} radius={9999} />)}
      </div>

      {['Do now', 'This week'].map(band => (
        <section key={band} className="space-y-3">
          <SkeletonLine w={110} h={11} />
          <SkeletonRows count={band === 'Do now' ? 3 : 4} />
        </section>
      ))}
    </div>
  )
}
