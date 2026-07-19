import { redirect } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'
import { PasswordField } from './PasswordField'

export default async function LoginPage() {
  if (await isAuthenticated()) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(1100px 600px at 50% -8%, #F7F0E1 0%, #EFE7D6 55%, #E9DFC9 100%)' }}>
      <div className="w-full max-w-sm">
        {/* Company logo */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/catday-logo.png" alt="Cat Day"
            width={252} height={106}
            className="w-[228px] h-auto select-none" style={{ pointerEvents: 'none' }} />
          <p className="text-[11px] font-semibold tracking-[0.28em] uppercase mt-4" style={{ color: '#B14919' }}>
            A Good Day for Every Cat
          </p>
        </div>

        {/* Sign-in card */}
        <form action="/api/login" method="POST"
          className="rounded-2xl p-7 space-y-5"
          style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)', boxShadow: '0 18px 40px -24px rgba(45,25,7,0.45)' }}>
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#2D1907' }}>
              Password
            </label>
            <PasswordField />
          </div>
          <button type="submit"
            className="w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-opacity hover:opacity-90"
            style={{ background: '#B14919', color: '#F7F0E1' }}>
            Sign In
          </button>
        </form>

        <p className="text-center text-xs mt-6 tracking-wide" style={{ color: 'rgba(45,25,7,0.4)' }}>
          Cat Day OS · Staff Portal
        </p>
      </div>
    </div>
  )
}
