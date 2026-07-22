import type { ReactNode } from 'react'

// Monochrome line icons for the sidebar. All use currentColor so they take the
// same cream tone as the nav text — no emoji, one consistent stroke weight.
const ICONS: Record<string, ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>),
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" /></>),
  ai: (<><path d="M12 3.5l1.7 4.6 4.8 1.4-4.8 1.4L12 15.5l-1.7-4.6L5.5 9.5l4.8-1.4z" /><path d="M5 15.5l.7 1.9 1.8.6-1.8.6L5 20.5l-.7-1.9L2.5 18l1.8-.6z" /></>),
  board: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>),
  scissors: (<><circle cx="6" cy="6.5" r="2.5" /><circle cx="6" cy="17.5" r="2.5" /><path d="M8.1 7.9 20 16M8.1 16.1 20 8" /></>),
  runsheet: (<><path d="M9 6h10M9 12h10M9 18h10" /><path d="M3.5 5.5l1.2 1.2L7 4.4M3.5 11.5l1.2 1.2L7 10.4M3.5 17.5l1.2 1.2L7 16.4" /></>),
  calendar: (<><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>),
  rooms: (<><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M4 9.5h16M4 15h16M10 3v18" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>),
  pos: (<><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.8h19M6 15h4" /></>),
  box: (<><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10.5h18" /><circle cx="16.5" cy="14.5" r="1.2" /></>),
  staff: (<><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c0-4 3.5-6 7.5-6s7.5 2 7.5 6" /></>),
  report: (<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  scale: (<><path d="M12 3.5v17M6.5 7.5h11M4 20.5h16" /><path d="M6.5 7.5 3.5 14a3 3 0 0 0 6 0zM17.5 7.5 14.5 14a3 3 0 0 0 6 0z" /></>),
  trend: (<><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></>),
  receipt: (<><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6" /></>),
  bars: (<><path d="M3 21h18" /><rect x="5" y="11.5" width="3.4" height="6.5" rx="0.6" /><rect x="10.3" y="7.5" width="3.4" height="10.5" rx="0.6" /><rect x="15.6" y="4" width="3.4" height="14" rx="0.6" /></>),
  compass: (<><circle cx="12" cy="12" r="9" /><path d="M16.2 7.8l-2.3 5.9-5.9 2.3 2.3-5.9z" /></>),
  customers: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 3-5.6 6.5-5.6S15.5 16.4 15.5 20" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 20c0-3-1.6-4.9-3.7-5.6" /></>),
  cat: (<><path d="M5 4.5 7.5 9M19 4.5 16.5 9" /><path d="M12 21c-4 0-7-3-7-7 0-3.2 1.6-5.4 3-7 1 2 3 2 4 2s3 0 4-2c1.4 1.6 3 3.8 3 7 0 4-3 7-7 7z" /><path d="M9.5 13h.01M14.5 13h.01M12 15.5v.01" /></>),
  star: (<><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.2 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" /></>),
  chat: (<><path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H8.5L4 21z" /><path d="M8 9.5h8M8 13h5" /></>),
  alert: (<><path d="M12 3.5 22 20.5H2z" /><path d="M12 10v4.5M12 17.8h.01" /></>),
  cap: (<><path d="M2.5 8.5 12 4l9.5 4.5L12 13z" /><path d="M6.5 11v4.5c0 1.2 2.9 2.5 5.5 2.5s5.5-1.3 5.5-2.5V11" /><path d="M21.5 8.5v5" /></>),
  logout: (<><path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 16.5l4.5-4.5L16 7.5M20.5 12h-11" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12h2.5M19 12h2.5M4.2 19.8l1.8-1.8M18 6l1.8-1.8" /></>),
  asset: (<><path d="M3.5 8.5 12 4l8.5 4.5-8.5 4.5z" /><path d="M3.5 8.5v7L12 20l8.5-4.5v-7" /><path d="M12 13v7" /><circle cx="16.2" cy="6.6" r="1" /></>),
}

export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  const paths = ICONS[name]
  if (!paths) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ display: 'block' }}>
      {paths}
    </svg>
  )
}
