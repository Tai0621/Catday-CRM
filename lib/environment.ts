export type AppEnv = 'production' | 'demo' | 'local'

// Which deployment this process is. Production is the real business's live OS;
// demo is the shared preview where unreleased work is shown; local is a dev
// machine.
//
// Derived rather than hardcoded so a new preview branch is automatically a demo
// and can never silently present itself as production. APP_ENV is the explicit
// override for the cases Vercel's own signal cannot cover (a self-hosted
// tenant, or a local process pointed at demo data).
export function appEnv(): AppEnv {
  const explicit = process.env.APP_ENV
  if (explicit === 'production' || explicit === 'demo' || explicit === 'local') return explicit

  // Vercel sets VERCEL_ENV to production | preview | development.
  switch (process.env.VERCEL_ENV) {
    case 'production': return 'production'
    case 'preview': return 'demo'
    default: return 'local'
  }
}

export const isProduction = () => appEnv() === 'production'

interface EnvBadge {
  label: string
  note: string
  background: string
  color: string
}

// Production deliberately has no badge — the real OS should look like the real
// OS, and anything else is a permanent visual tax on the people using it daily.
export const ENV_BADGE: Record<Exclude<AppEnv, 'production'>, EnvBadge> = {
  demo: {
    label: 'DEMO',
    note: 'Preview build with sample data — nothing here affects the live business.',
    background: '#729094',
    color: '#F2EDE0',
  },
  local: {
    label: 'LOCAL',
    note: 'Development machine.',
    background: '#2D1907',
    color: '#ECDBB6',
  },
}
