import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { search, roleKeyFor } from '@/lib/search'

// The command palette's endpoint.
//
// Access is decided per RESULT in lib/search.ts, not per route, which is the
// only shape that works here: this one endpoint has to serve a groomer and the
// owner, returning different things to each. Putting it behind a role in
// proxy.ts would either lock out the staff who need it or hand everything to
// whoever gets in.
//
// So the route's own job is small: prove there is a session, and pass the role
// through. Everything else is the search module's rule — a result is returned
// only if the session could open the page it links to.

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q') ?? ''
  const groups = await search(roleKeyFor(session), q)

  return NextResponse.json({ groups }, {
    // A person's search terms and the names they matched are not something to
    // leave in a shared cache.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
