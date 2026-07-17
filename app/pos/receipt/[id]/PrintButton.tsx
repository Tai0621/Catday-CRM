'use client'

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="cd-btn text-sm">
      Print
    </button>
  )
}
