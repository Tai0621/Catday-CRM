import { redirect } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default async function LoginPage() {
  if (await isAuthenticated()) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F2EDE0' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style={{ background: '#2D1907' }}>
            <span className="text-2xl">🐾</span>
          </div>
          <h1 className="text-2xl font-bold tracking-widest uppercase" style={{ fontFamily: 'var(--font-brand)', color: '#2D1907', letterSpacing: '0.15em' }}>cat day</h1>
          <p className="text-xs tracking-widest uppercase mt-1" style={{ color: '#B14919', letterSpacing: '0.2em' }}>A Good Day for Every Cat</p>
        </div>
        <form action="/api/login" method="POST" className="rounded-2xl p-8 space-y-4" style={{ background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.1)' }}>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: '#2D1907', letterSpacing: '0.1em' }}>Password</label>
            <input name="password" type="password" required autoFocus
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: '#F2EDE0', border: '1px solid rgba(45,25,7,0.2)', color: '#2D1907' }} />
          </div>
          <button type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-opacity hover:opacity-90"
            style={{ background: '#B14919', color: '#ECDBB6' }}>
            Sign In
          </button>
        </form>
        <p className="text-center text-xs mt-6" style={{ color: 'rgba(45,25,7,0.35)' }}>Catday CRM · Staff Portal</p>
      </div>
    </div>
  )
}
