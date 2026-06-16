import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { ENROLLMENT_STATUSES } from '@/lib/constants'
import Link from 'next/link'

export default async function AcademyPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAuth()
  const { status } = await searchParams

  const enrollments = await db.academyEnrollment.findMany({
    where: status ? { status } : {},
    orderBy: { enrolledAt: 'desc' },
  })

  const stats = await db.academyEnrollment.groupBy({ by: ['status'], _count: true })
  const statMap = Object.fromEntries(stats.map((s: { status: string; _count: number }) => [s.status, s._count]))

  async function enroll(data: FormData) {
    'use server'
    await db.academyEnrollment.create({
      data: {
        studentName: data.get('studentName') as string,
        email: data.get('email') as string,
        phone: (data.get('phone') as string) || null,
        course: data.get('course') as string,
        notes: (data.get('notes') as string) || null,
      },
    })
    redirect('/academy')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Academy</h1>
          <p className="text-sm text-gray-500">Online grooming academy enrollments</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {ENROLLMENT_STATUSES.map(s => (
          <Link key={s} href={`?status=${s}`}
            className={`rounded-xl border px-4 py-3 text-center hover:opacity-80 transition-opacity ${status === s ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-gray-200'}`}>
            <div className={`text-xl font-bold ${status === s ? 'text-white' : 'text-gray-900'}`}>{statMap[s] ?? 0}</div>
            <div className={`text-xs ${status === s ? 'text-rose-100' : 'text-gray-400'}`}>{s}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Course</th>
                <th className="px-4 py-3 text-left">Enrolled</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {enrollments.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No enrollments yet</td></tr>
              )}
              {enrollments.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.studentName}</div>
                    <div className="text-xs text-gray-400">{e.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{e.course}</td>
                  <td className="px-4 py-3 text-gray-400">{e.enrolledAt.toLocaleDateString('en-MY')}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${enrollmentClass(e.status)}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">New Enrollment</h2>
          <form action={enroll} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Student Name *</label>
              <input name="studentName" required placeholder="Full name"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
              <input name="email" type="email" required placeholder="email@example.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input name="phone" placeholder="012-3456789"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Course *</label>
              <input name="course" required placeholder="e.g. Cat Grooming Basics"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <textarea name="notes" rows={2} placeholder="Optional…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <button type="submit" className="w-full bg-rose-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-rose-700">
              Enroll Student
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function enrollmentClass(s: string) {
  const m: Record<string, string> = {
    Pending: 'bg-amber-100 text-amber-700',
    Active: 'bg-green-100 text-green-700',
    Completed: 'bg-blue-100 text-blue-700',
    Withdrawn: 'bg-gray-100 text-gray-500',
  }
  return m[s] ?? 'bg-gray-100 text-gray-500'
}
