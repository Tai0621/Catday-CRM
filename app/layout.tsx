import type { Metadata } from 'next'
import { Inter, Space_Mono } from 'next/font/google'
import './globals.css'
import { Nav } from './components/Nav'
import { getSession } from '@/lib/auth'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-brand' })

export const metadata: Metadata = {
  title: 'Catday CRM',
  description: 'Customer & operations management for Catday',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-linen text-espresso">
        {session ? (
          <div className="flex h-screen overflow-hidden">
            <Nav role={session.kind === 'manager' ? 'Manager' : session.role} userName={session.name} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        ) : (
          <main>{children}</main>
        )}
      </body>
    </html>
  )
}
