import type { NextConfig } from "next";

// A CSP we can *enforce* today without breaking the app: these directives don't
// touch inline script/style (which Next + the app's inline styles rely on), so
// they're safe to turn on now. Tightening script-src/style-src comes later via
// the report-only policy below.
const CSP_ENFORCED = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// The policy we're working toward — shipped as report-only so violations show
// up in the browser console without breaking anything, so we can tighten to it.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Content-Security-Policy', value: CSP_ENFORCED },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  // HSTS only in production — never pin localhost/http to HTTPS.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  // The receipt PDF reads the logo off disk at request time. On Vercel `public/`
  // is uploaded as CDN assets and is NOT automatically inside the function
  // bundle, so without this the file is missing in production only — the logo
  // would quietly vanish from every customer receipt while looking perfect
  // locally. renderReceiptPdf falls back to a text wordmark rather than failing,
  // which is exactly the kind of silent downgrade nobody would notice.
  // Every raster in public/, not one named file: the receipt logo comes from the
  // `brand.logoUrl` SETTING, so which file it needs is decided by the owner at
  // runtime and cannot be listed at build time.
  outputFileTracingIncludes: {
    '/r/[token]': [
      './public/**/*.png', './public/**/*.jpg', './public/**/*.jpeg',
      // The brand fonts are read off disk at request time, so tracing cannot
      // see them from the import graph. Without this the receipt silently falls
      // back to Helvetica in production only — the exact kind of downgrade
      // nobody notices, because it still renders.
      './node_modules/@fontsource/inter/files/inter-latin-400-normal.woff',
      './node_modules/@fontsource/inter/files/inter-latin-700-normal.woff',
      './node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff',
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // v1.3.0 renamed Products to Inventory. Kept for bookmarks and for links in
  // old briefs and AI proposals. Note this alone does NOT rescue a staff role
  // that was granted `/products`: access is checked on the DESTINATION, so the
  // stored role paths had to be rewritten too (scripts/migrate-cat-inventory.mjs).
  async redirects() {
    return [
      { source: '/products', destination: '/inventory/products', permanent: false },
      { source: '/products/:id', destination: '/inventory/products/:id', permanent: false },
      // The rooms list stopped being its own tab and became a section of the
      // wall. Redirected HERE rather than with `permanentRedirect()` in a page:
      // `app/loading.tsx` puts every route behind Suspense, so the shell has
      // already streamed by the time a page body runs and Next can only fall
      // back to a client-side bounce — a 200 that needs JavaScript to move.
      // A config redirect is a real 307 before any render.
      { source: '/rooms/list', destination: '/rooms', permanent: false },
    ];
  },
};

export default nextConfig;
