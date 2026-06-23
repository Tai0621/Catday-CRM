'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS: Record<string, string> = {
  Grooming:   '#B14919',
  Boarding:   '#729094',
  Membership: '#E7CE7A',
  Academy:    '#2D1907',
  Other:      '#ECDBB6',
}

export function RevenueChart({ data, categories }: { data: Record<string, unknown>[]; categories: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(45,25,7,0.08)" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `RM${v}`} />
        <Tooltip formatter={(v) => `RM ${Number(v).toFixed(2)}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {categories.map(cat => (
          <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[cat] ?? '#9ca3af'} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
