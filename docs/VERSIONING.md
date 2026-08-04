# Versioning & release policy

The OS follows [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH` — but the meaning of
each level is defined by **what an existing tenant has to do to take the upgrade**, not by API
surface. That is the useful question here, because every client runs their own single-tenant
deployment with their own Turso database, and schema changes are hand-written migration scripts
(see `AGENTS.md`), not an automatic `prisma migrate`.

`package.json` holds the current version and is the single source of truth. `lib/version.ts` reads
it; nothing else hardcodes a version number.

## What each level means

| Level | Meaning | Upgrade cost for a live tenant |
|---|---|---|
| **MAJOR** | A breaking change that needs a human decision or manual step beyond running migrations. | Read the release notes before deploying. Examples: renaming or removing a required env var, invalidating all sessions (`SESSION_EPOCH` bump, `SESSION_SECRET` rotation), re-interpreting existing data, removing a route staff have bookmarked, or a migration that is not safely re-runnable. |
| **MINOR** | New capability, backwards compatible. May add tables, columns, or indexes. | Run the new `scripts/migrate-*.mjs`, deploy. Nothing existing changes behaviour. |
| **PATCH** | Fixes, copy, and visual polish. No schema change, no config change. | Deploy. |

**Additive migrations are MINOR, not MAJOR** — new tables and nullable columns are safe, and every
migration script is idempotent by convention. A migration that *drops* or *rewrites* existing data is
MAJOR, even if the code change looks small. `1.1.0` dropping `Cat.photos` is the edge case that
proves the rule: it was safe only because the column was already orphaned and unread.

## Where the version is visible

- `package.json` — the source of truth.
- `lib/version.ts` — `OS_VERSION`, imported wherever it is displayed.
- **Admin → Business Settings** — shows the running version, so a support conversation with any
  tenant starts from a known build rather than a guess.
- `git tag` — an annotated tag per release.
- `CHANGELOG.md` — what changed and why.

## Branch and tag conventions

The local default branch is `master`; GitHub's is `main`. Push with `git push origin master:main`
(a bare `git push` does the wrong thing here). Tags are annotated (`git tag -a`), never lightweight,
so each release carries a message explaining what it was.

## Working through a cycle

While `1.2.0` is in development, `package.json` already says `1.2.0` and `CHANGELOG.md` keeps a
`[1.2.0] — Unreleased` section at the top. Add to that section as work lands, in the same commit as
the work — a changelog written retroactively at release time is a changelog full of guesses.

## Release checklist

Cut a release when a coherent chunk of work is done, not on a calendar.

1. `npm run build` — clean compile (this also runs `prisma generate`, so it surfaces any
   schema/client mismatch).
2. Every `scripts/migrate-*.mjs` added this cycle has been fanned out to **every tenant**
   (`npm run migrate:all -- scripts/migrate-<feature>.mjs`), and `npx prisma generate` has been run.
   Tenants share a deploy but not a database — pushing before every tenant is migrated breaks all of
   them at once. See [ENVIRONMENTS.md](ENVIRONMENTS.md).
3. Every relevant `scripts/verify-*.mjs` passes — including existing ones that shared logic could
   plausibly have regressed, not just the new one. Report the pass count.
4. Decide the level from the table above. When it is genuinely ambiguous between MINOR and MAJOR,
   pick MAJOR — the cost of an over-cautious release note is nothing; the cost of a tenant taking a
   breaking change unannounced is a broken business.
5. Set the date on the `[Unreleased]` heading in `CHANGELOG.md` and open a fresh `Unreleased`
   section above it.
6. Bump `package.json` to the version being released, then to the next working version after
   tagging.
7. Commit, tag (`git tag -a vX.Y.Z -F -`), and push both:
   ```
   git push origin master:main --follow-tags
   ```
8. For a MAJOR release, write the manual steps into the changelog entry itself — not into a commit
   message nobody will find six months later.

## Per-tenant version tracking

Once more than one client is live, they will not all be on the same version. The tenant's running
version is visible in their own Admin → Business Settings; check it there before diagnosing anything
reported from the field, because "it's broken" and "you're two releases behind" look identical from
here.
