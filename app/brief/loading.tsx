import { SkeletonLine, SkeletonBlock } from '@/app/components/Skeleton'

// The landing page, so this is the first thing anyone sees after signing in —
// which makes it the skeleton that most has to be honest. It mirrors the brief
// archive: a heading, then dated cards each with a few lines of reading.
export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto space-y-5" role="status" aria-busy="true" aria-label="Loading the morning brief">
      <div className="space-y-2">
        <SkeletonLine w={190} h={22} />
        <SkeletonLine w="70%" h={11} />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="cd-card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <SkeletonLine w={210} h={13} />
            <SkeletonLine w={64} h={10} />
          </div>
          <SkeletonLine w="100%" h={10} />
          <SkeletonLine w="94%" h={10} />
          <SkeletonLine w="62%" h={10} />
          <div className="flex gap-2 pt-1">
            <SkeletonBlock w={96} h={26} radius={999} />
            <SkeletonBlock w={82} h={26} radius={999} />
          </div>
        </div>
      ))}
    </div>
  )
}
