import { SkeletonLine, SkeletonBlock } from '@/app/components/Skeleton'

// The service board is lanes, not a list — a generic table skeleton would
// resolve into columns and jump. This is the Groomer's home screen.
export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-5" role="status" aria-busy="true" aria-label="Loading the service board">
      <div className="space-y-2">
        <SkeletonLine w={170} h={22} />
        <SkeletonLine w="55%" h={11} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[3, 2, 2, 1].map((rows, lane) => (
          <div key={lane} className="space-y-2">
            <SkeletonLine w={110} h={11} />
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="cd-card p-3 space-y-2">
                <SkeletonLine w="72%" h={12} />
                <SkeletonLine w="52%" h={10} />
                <SkeletonBlock w="100%" h={28} radius={8} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
