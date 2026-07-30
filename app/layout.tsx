import type { Metadata } from 'next'
import { Inter, Space_Mono } from 'next/font/google'
import './globals.css'
import { Nav } from './components/Nav'
import { getSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-brand' })

export async function generateMetadata(): Promise<Metadata> {
  const { business } = await getConfig()
  return {
    title: `${business.name} OS`,
    description: `Customer & operations management for ${business.name}`,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, config] = await Promise.all([getSession(), getConfig()])
  const brandVars = `:root{--brand-primary:${config.brand.primary};--brand-ink:${config.brand.ink}}`

  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-linen text-espresso">
        {/* White-label overrides (Track B) — after globals.css so they win. */}
        <style dangerouslySetInnerHTML={{ __html: brandVars }} />
        {session ? (
          <div className="flex h-screen overflow-hidden">
            <Nav role={session.kind === 'manager' ? 'Manager' : session.role} userName={session.name}
              logoUrl={config.brand.logoDarkUrl} brandName={config.business.name} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        ) : (
          <main>{children}</main>
        )}
      </body>
    </html>
  )
}
