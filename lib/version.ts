import pkg from '@/package.json'

// Single-sourced from package.json so a release only ever bumps one number.
// Surfaced in Admin → Business Settings: once more than one client is live they
// will not all be on the same version, and "it's broken" looks identical to
// "you're two releases behind" unless the build is visible in the tenant's own UI.
// Release policy: docs/VERSIONING.md
export const OS_VERSION: string = pkg.version
export const OS_NAME = 'Cat Day OS'
export const OS_RELEASE = `${OS_NAME} v${OS_VERSION}`
