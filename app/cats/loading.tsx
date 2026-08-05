import { SkeletonHeader, SkeletonFilters, SkeletonCardGrid } from '../components/Skeleton'

// Cats is a card grid with a photo thumbnail on the left, not a table — the
// generic fallback would shift the whole page once the real content lands.
export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-4" role="status" aria-busy="true" aria-label="Loading cats">
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonCardGrid count={6} media />
    </div>
  )
}
