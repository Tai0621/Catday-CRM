import { redirect } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default async function LoginPage() {
  if (await isAuthenticated()) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-rose-600">Catday</h1>
          <p className="text-sm text-gray-500 mt-1">CRM</p>
        </div>
        <form action="/api/login" method="POST" className="bg-white rounded-2xl border border-gray-200 p-8 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input name="password" type="password" required autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
          <button type="submit"
            className="w-full bg-rose-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-rose-700">
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
