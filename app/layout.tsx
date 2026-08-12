import type { Metadata } from 'next'
import { Inter, Space_Mono } from 'next/font/google'
import './globals.css'
import { Nav } from './components/Nav'
import { getSession } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { canAccess, homeFor, visiblePaths, navFor } from '@/lib/roles-store'
import { getConfig } from '@/lib/config'
import { EnvBanner } from './components/EnvBanner'
import { Copilot } from './components/Copilot'
import { isProduction } from '@/lib/environment'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-brand' })

export async function generateMetadata(): Promise<Metadata> {
  const { business } = await getConfig()
  return {
    title: `${business.name} OS`,
    description: `Customer & operations management for ${business.name}`,
    // The demo is a public URL running a real-looking business. Keep it out of
    // search results so it never competes with, or is mistaken for, the client.
    ...(isProduction() ? {} : { robots: { index: false, follow: false } }),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, config] = await Promise.all([getSession(), getConfig()])
  const brandVars = `:root{--brand-primary:${config.brand.primary};--brand-ink:${config.brand.ink}}`

  // Per-role PAGE access, decided here rather than in proxy.ts.
  //
  // Roles are rows the owner edits, and the edge runtime cannot read the
  // database — so this is the one place that can enforce what the owner
  // actually ticked, on the request it applies to. It runs before any page
  // renders, and being in the ROOT layout it cannot be forgotten on a new page
  // the way a per-page guard can.
  const staffRole = session && session.kind !== 'manager' ? session.role : null
  let visible: string[] | null = null
  let staffNav: Awaited<ReturnType<typeof navFor>> | null = null
  if (staffRole) {
    const pathname = (await headers()).get('x-pathname') ?? ''
    if (pathname && !(await canAccess(staffRole, pathname))) {
      redirect(await homeFor(staffRole))
    }
    visible = await visiblePaths(staffRole)
    staffNav = await navFor(staffRole)
  }

  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable} h-full antialiased`}>
      {/* Column layout so the environment banner can take its own row without
          the app shell overflowing; in production the banner renders nothing and
          the shell is the sole child, i.e. exactly the previous full-height. */}
      <body className="h-full flex flex-col bg-linen text-espresso">
        {/* White-label overrides (Track B) — after globals.css so they win. */}
        <style dangerouslySetInnerHTML={{ __html: brandVars }} />
        <EnvBanner />
        <div className="flex-1 min-h-0">
          {session ? (
            <div className="flex h-full overflow-hidden">
              <Nav role={session.kind === 'manager' ? 'Manager' : session.role} userName={session.name} visiblePaths={visible} staffNav={staffNav}
                logoUrl={config.brand.logoDarkUrl} brandName={config.business.name} />
              <main className="flex-1 overflow-y-auto p-6">{children}</main>
              {/* Signed-in only — the copilot reads business data. */}
              <Copilot />
            </div>
          ) : (
            <main>{children}</main>
          )}
        </div>
      </body>
    </html>
  )
}
