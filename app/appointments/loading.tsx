import { SkeletonHeader, SkeletonFilters, SkeletonTable } from '../components/Skeleton'

// Same table shape as the fallback, but appointments renders at max-w-5xl —
// inheriting the wider default would visibly narrow the page on arrival.
export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-4" role="status" aria-busy="true" aria-label="Loading appointments">
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonTable rows={10} cols={6} />
    </div>
  )
}
