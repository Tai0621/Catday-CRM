import { SkeletonLine, SkeletonBlock } from '@/app/components/Skeleton'

// The boarding wall is the one page in the OS whose shape is nothing like a
// list, so the generic table skeleton would have been a lie that jumps when the
// real thing lands. This mirrors the cabinets: tiles in banks, on the carcass
// colour, under the tile row and the date strip.
const CARCASS = '#F3EBD0'

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-4" role="status" aria-busy="true" aria-label="Loading the boarding wall">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <SkeletonLine w={160} h={22} />
          <SkeletonLine w={210} h={11} />
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} w={88} h={54} radius={12} />)}
        </div>
      </div>

      <SkeletonBlock w="100%" h={54} radius={12} />

      {[10, 8].map((count, bank) => (
        <div key={bank} className="space-y-1.5">
          <SkeletonLine w={150} h={10} />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 116px)', gridAutoRows: '84px',
            gap: 7, padding: 7, borderRadius: 9, background: CARCASS,
            border: '1.5px solid rgba(45,25,7,0.72)', width: 'fit-content',
          }}>
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="cd-skeleton" style={{ borderRadius: 4, opacity: 0.55 }} aria-hidden />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
