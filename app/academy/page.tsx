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
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Academy</h1>
          <p className="text-sm cd-muted">Online grooming academy enrollments</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {ENROLLMENT_STATUSES.map(s => (
          <Link key={s} href={`?status=${s}`}
            className="rounded-xl px-4 py-3 text-center hover:opacity-85 transition-opacity"
            style={status === s
              ? { background: '#B14919', border: '1px solid #B14919' }
              : { background: '#ECDBB6', border: '1px solid rgba(45,25,7,0.12)' }
            }>
            <div className="text-xl font-bold" style={{ color: status === s ? '#ECDBB6' : '#2D1907' }}>
              {statMap[s] ?? 0}
            </div>
            <div className="text-xs" style={{ color: status === s ? 'rgba(236,219,182,0.75)' : 'rgba(45,25,7,0.45)' }}>
              {s}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 cd-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Student</th>
              <th>Course</th>
              <th>Enrolled</th>
              <th>Status</th>
            </tr></thead>
            <tbody className="cd-tbody">
              {enrollments.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center cd-muted">No enrollments yet</td></tr>
              )}
              {enrollments.map(e => (
                <tr key={e.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium" style={{ color: '#2D1907' }}>{e.studentName}</div>
                    <div className="text-xs cd-muted">{e.email}</div>
                  </td>
                  <td className="px-4 py-3 cd-muted">{e.course}</td>
                  <td className="px-4 py-3 cd-muted">{e.enrolledAt.toLocaleDateString('en-MY')}</td>
                  <td className="px-4 py-3">
                    <span className="cd-pill" style={enrollmentStyle(e.status)}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cd-card p-5">
          <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>New Enrollment</h2>
          <form action={enroll} className="space-y-3">
            <div>
              <label className="cd-label">Student Name *</label>
              <input name="studentName" required placeholder="Full name" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Email *</label>
              <input name="email" type="email" required placeholder="email@example.com" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Phone</label>
              <input name="phone" placeholder="012-3456789" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Course *</label>
              <input name="course" required placeholder="e.g. Cat Grooming Basics" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Notes</label>
              <textarea name="notes" rows={2} placeholder="Optional…" className="cd-input" style={{ resize: 'none' }} />
            </div>
            <button type="submit" className="cd-btn w-full text-center">Enroll Student</button>
          </form>
        </div>
      </div>
    </div>
  )
}

function enrollmentStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Pending:   { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    Active:    { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    Completed: { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    Withdrawn: { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
