import { SkeletonHeader, SkeletonFilters, SkeletonTable } from '@/app/components/Skeleton'

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-4" role="status" aria-busy="true" aria-label="Loading customers">
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonTable rows={10} cols={6} />
    </div>
  )
}
