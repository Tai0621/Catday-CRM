import { SkeletonHeader, SkeletonFilters, SkeletonTable } from './components/Skeleton'

// App-wide route-transition feedback, shown the moment a nav link is clicked
// while the server renders the page. Routes with a distinctly different shape
// (card grids, the Action Inbox) provide their own loading.tsx; this is the
// fallback, shaped like the list-and-table pages that dominate the OS.
//
// Replaced a centred spinner that also printed the business name in the brand
// font — which would have shown the first client's name to every other tenant.
export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-4" role="status" aria-busy="true" aria-label="Loading">
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonTable />
    </div>
  )
}
