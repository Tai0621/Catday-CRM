import pkg from '@/package.json'

// ── Product identity vs tenant identity ──────────────────────────────────────
// Bizkit is the PRODUCT: one codebase, one version line, many clients. Cat Day
// is a TENANT — one deployment with its own database and its own branding.
//
// These must never be confused in the UI. Everything a tenant's staff see is
// driven by config.business.name (Track B); the product name belongs only where
// *we* need it — the version stamp a support conversation starts from.
//
// This file previously hardcoded 'Cat Day OS', which would have told the second
// client they were running the first client's system.
//
// Release policy: docs/VERSIONING.md
export const PRODUCT_NAME = 'Bizkit'
export const OS_VERSION: string = pkg.version

/** Platform build stamp, e.g. "Bizkit v1.2.0" — for support, not for staff-facing chrome. */
export const PRODUCT_RELEASE = `${PRODUCT_NAME} v${OS_VERSION}`
