# BookOrbit native PostgreSQL migration

This is a database-only migration. BookOrbit keeps its currently deployed r21 image. PostgreSQL and pgvector run as independent native DSM SPKs, not as container wrappers.

## Current acceptance

On 2026-10-27, PostgreSQL18.6-10019 and independent vector0.8.7-10006 passed DSM installation, uploaded upgrades and whole-NAS reboot. The late-network-address problem was reproduced during that reboot and recovered automatically. Core data remains `/volume1/database/pg/data/18`.

A fresh consistent snapshot of production was restored into `bookorbit_preflight_20261027`. All167 table row counts matched before starting the test client. The exact production image ID then passed database health, book query (11 books), detail, 8 parallel details, file Range and anonymous rejection checks. Books were mounted read-only, application data was copied, the JWT key was independent, and the internal network had no Internet access. Both test clients were stopped afterwards.

Private evidence remains on NAS under `/volume1/database/pg/state/bookorbit-migration-preflight-20261027-r2/`. Snapshot: `/volume1/database/pg/backups/bookorbit-preflight-20261027T103714Z`. Neither credentials nor source environments were copied to the Mac or Git.

The persistent native deployment profile passed 8 real checks: no postgres container/service dependency; same image/JWT; native host/password resolution; identical mount sources/modes and read-only root filesystem. DSM Compose2.20 cannot parse this deployment's interpolated ports with `--no-interpolate`; preparation reads the supported resolved profile, then restores dotenv references for credentials and existing environment keys.

## Tools and checks

Run local regression checks:

```sh
pnpm run test:synology-native-pg
```

Copy these scripts together to a root-private NAS directory:

- `scripts/synology/native/backup-container-db.py`
- `scripts/synology/native/stage-native-pg-app.py`
- `scripts/synology/native/prepare-native-pg-migration.py`
- `scripts/synology/native/apply-native-pg-migration.py`

The prepare tool creates a new consistent snapshot, an independent restore, a bounded isolated application and an acceptance report. It never stops or changes production. Use a new stage directory and a dedicated `bookorbit_preflight_YYYYMMDD` database. It retains failed copies for inspection instead of overwriting existing databases.

The apply tool defaults to a read-only readiness check. It verifies application/preflight/reboot/profile evidence, source container identities, configuration hashes, the native target being unused, network identity and no active book-source jobs. Explicit `--execute` is reserved for an authorized production cutover.

## Cutover transaction

1. Stop the production application, verify no other clients remain on its original DB, then take a new consistent source dump plus private application/configuration backup. The earlier online snapshot is not used as final production data.
2. Restore into a new native application database with a non-superuser role and24 connection allowance for the existing20-connection pool. Verify all table counts before starting the application. Add only that database/role's SCRAM rule for the existing private Docker network.
3. Compile and validate a native compose profile without the postgres service/dependency. Preserve image, JWT, mounts and original application data. Save the old `.env`, compose and complete container metadata privately; atomically replace each configuration file.
4. Retain the stopped old application under a new name and disable its autostart. Recreate the production application through Compose so future Compose updates have correct project labels. Verify native connections and production health.
5. Save a commitment receipt before retiring the old DB. Stop the original DB container and disable its autostart, preserving the container and **all** bind and anonymous volumes. PostgreSQL18 images may hold data in an anonymous `/var/lib/postgresql` volume as well as older bind paths; never assume that deleting only one mount is harmless.

## Failure boundary

Before commitment, initial startup failure restores the old environment/profile and original application; the native copy is retained for diagnosis. Once native production health and native DB connections are confirmed and the commitment receipt is saved, follow-up errors do not automatically point users to a stale DB. New user writes must be preserved with a fresh reverse migration if rollback is required later. Do not delete old containers or data as part of cutover.

The package remains BETA until production cutover and validation finish. Whole-NAS reboot acceptance is already passed for10019; do not report production migration as complete merely because a test client passed.
