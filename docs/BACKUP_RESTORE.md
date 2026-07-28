# Backup & Restore

The database is Turso (libSQL). Turso keeps its own point-in-time backups, but we
also take **self-contained logical backups** we control, so a client's data can
be exported, moved, or restored without depending on the Turso console.

## Back up

```bash
node scripts/backup-db.mjs
```

- Writes a full JSON dump of every table to `./backups/backup-<timestamp>.json`
  (git-ignored).
- If `BLOB_READ_WRITE_TOKEN` is set, also uploads a copy to Vercel Blob under
  `backups/`.
- Safe to run any time; read-only against the database.

**Schedule it.** Add a daily Vercel Cron (or any scheduler) that runs the backup
and relies on the Blob copy for off-box retention. Keep at least 7 daily copies.

## Restore

Restore is for disaster recovery into a **fresh** database (e.g. a new Turso DB
for a new client, or rebuilding after loss).

1. Point `.env` at the target database (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`).
2. **Create the schema first** by running the migration scripts in order:
   ```bash
   for f in scripts/migrate-*.mjs; do node "$f"; done
   ```
3. Dry-run the restore to see what it will write:
   ```bash
   node scripts/restore-db.mjs backups/backup-<timestamp>.json
   ```
4. Apply it (DESTRUCTIVE — deletes each table's contents, then re-inserts):
   ```bash
   node scripts/restore-db.mjs backups/backup-<timestamp>.json --confirm
   ```

The restore disables foreign-key enforcement for the duration, so table order
doesn't matter.

## Notes

- Backups include everything, including base64 image data stored on `Cat.photos`,
  so files can be large — that's expected for a full logical dump.
- Media stored in Vercel Blob (the `MediaAsset` rows point at it) is **not** part
  of this dump; back up the Blob store separately if needed.
- Test a restore into a throwaway Turso database periodically — an untested backup
  is not a backup.
