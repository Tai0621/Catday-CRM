import { SkeletonLine, SkeletonBlock } from '@/app/components/Skeleton'

// The boarding carer's home screen: a stack of stays, each with its own
// tickable care list underneath.
export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-5" role="status" aria-busy="true" aria-label="Loading the run sheet">
      <div className="space-y-2">
        <SkeletonLine w={150} h={22} />
        <SkeletonLine w="60%" h={11} />
      </div>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="cd-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SkeletonLine w={180} h={13} />
            <SkeletonBlock w={70} h={22} radius={999} />
          </div>
          <div className="space-y-2 pt-1">
            {[0, 1, 2].map(t => (
              <div key={t} className="flex items-center gap-2.5">
                <SkeletonBlock w={22} h={22} radius={6} />
                <SkeletonLine w={`${45 + ((i + t) % 3) * 14}%`} h={10} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
