'use client'

export function DatePicker({ defaultValue }: { defaultValue: string }) {
  return (
    <input
      type="date"
      defaultValue={defaultValue}
      onChange={e => { window.location.href = `?date=${e.target.value}` }}
      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
    />
  )
}
