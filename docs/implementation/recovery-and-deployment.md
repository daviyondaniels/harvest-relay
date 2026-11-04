# Recovery and deployment runbook

## Scope and evidence

The recovery CLI snapshots the SQLite database using Node's SQLite backup API, including committed WAL data. A bundle consists of `workbench.db` and a final `manifest.json` with format, timestamp, SHA-256, byte size and workspace counts. Verification checks the hash, SQLite integrity and current snapshot/planner compatibility. It is a recovery tool for trusted application backups, not a general database importer or an authenticated signature.

The five recovery tests cover a live WAL database with both workspace types, exact state/history/version recovery and continued CAS writes, overwrite refusal, corrupt/incompatible state, tampered bytes/manifest, and visitor expiry preservation. A separate CLI drill restored the synthetic local demo database with its two independent workspaces. Neither proves off-host retention or unattended backup scheduling.

## Backup, verify and restore drill

Use the supported Node 24 runtime. Choose a protected parent directory outside Git; the output directory must not exist. Recovery commands never overwrite a destination. Backups hold complete state, including reviewer names, source messages and visitor capability hashes. Keep them private, restrict host/file access and copy verified bundles to a protected separate host if durability matters.

```sh
npm run recovery -- backup /absolute/path/workbench.db /protected/backups/day-001
npm run recovery -- verify /protected/backups/day-001
npm run recovery -- restore /protected/backups/day-001 /protected/restore-drill/day-001
```

Parent directories must already exist. A failed backup may leave an incomplete directory; without a valid final manifest it is not a usable bundle. The tool refuses files above 200 MiB and unsupported schemas. It does not rotate or delete backups. Do not delete old backups until a newer verified bundle has passed a restore drill and the retention policy is agreed.

Restore writes `NEW_DIRECTORY/workbench.db`. Point an isolated application instance at that file and check the expected orders, history, commitments, stale-review refusal and export. Never practice on the live database. Visitor expiry remains absolute; restoration does not renew expired sessions. The JSON day export remains an evidence artifact, not a replacement for the database backup.

## Controlled cutover

1. Record the active commit, runtime, environment flags, database path and proxy target. Do not print or copy model credentials into logs.
2. Build the intended frozen commit in a separate checkout; run tests, typecheck and production build. Keep the old process running.
3. Back up the current application database and verify the bundle. For the isolated synthetic demo, use a separate new database; retain the old private workbench unchanged.
4. Start the new build on a free loopback-only port with `HARVEST_PUBLIC_DEMO=1`, `HARVEST_LIVE_CALLS=0` and `HARVEST_SECURE_COOKIES=1` behind the HTTPS proxy. Do not load model credentials. Configure persistent storage outside the disposable build directory.
5. Verify missing-session redirection to `/start`, then route only the existing Harvest Relay proxy to the staged port. Confirm all other proxy entries are unchanged.
6. Through the original HTTPS origin, start a workspace; approve a reduction; check order adjustment, guide, recorded provenance, reset/export isolation and affected-sheet reconfirmation. Check secure HttpOnly cookie configuration. A tailnet-only URL is not demonstrated public judge access.
7. Roll back the same proxy to its recorded old target if verification fails. A full state rollback requires stopping writers and planning how open browser tabs/sessions are invalidated; simply replacing an in-use SQLite file is not supported.

The inspected host used Node 24.13.1, `/home/ayliea/dev/harvest-relay-demo`, and a port-3600 Tailscale HTTPS proxy to loopback port 3600. These are observed deployment facts, not portable defaults. A new loopback backend can be staged without modifying the old checkout or exposing a new public listener.

## Remaining operational gates

Supervision/start-on-reboot, off-host backup retention, host failure recovery, customer accounts/roles, organization isolation, monitoring and outbound delivery are separate production work. A successful demo cutover must not be described as solving these. Public source still needs an owner rights/license decision; the heuristic history screen alone does not establish publication rights.

Reference: [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options).
