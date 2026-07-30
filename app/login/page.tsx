import { redirect } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { PasswordField } from './PasswordField'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthenticated()) redirect('/')
  const config = await getConfig()
  const { error } = await searchParams
  const errorMsg = error === 'rate'
    ? 'Too many attempts. Please wait a few minutes and try again.'
    : error
    ? 'Incorrect password. Please try again.'
    : null

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(1100px 600px at 50% -8%, #F7F0E1 0%, #EFE7D6 55%, #E9DFC9 100%)' }}>
      <div className="w-full max-w-sm">
        {/* Company logo */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.brand.logoUrl} alt={config.business.name}
            width={252} height={106}
            className="w-[228px] h-auto select-none" style={{ pointerEvents: 'none' }} />
          <p className="text-[11px] font-semibold tracking-[0.28em] uppercase mt-4" style={{ color: 'var(--brand-primary)' }}>
            {config.business.tagline}
          </p>
        </div>

        {/* Sign-in card */}
        <form action="/api/login" method="POST"
          className="rounded-2xl p-7 space-y-5"
          style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)', boxShadow: '0 18px 40px -24px rgba(45,25,7,0.45)' }}>
          {errorMsg && (
            <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
              style={{ background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
              {errorMsg}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#2D1907' }}>
              Password
            </label>
            <PasswordField />
          </div>
          <button type="submit"
            className="w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-opacity hover:opacity-90"
            style={{ background: 'var(--brand-primary)', color: '#F7F0E1' }}>
            Sign In
          </button>
        </form>

        <p className="text-center text-xs mt-6 tracking-wide" style={{ color: 'rgba(45,25,7,0.4)' }}>
          {config.business.name} OS · {config.portalLabel}
        </p>
      </div>
    </div>
  )
}
