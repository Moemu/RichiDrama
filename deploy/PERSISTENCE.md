# Production data persistence

Application code and production data are deliberately separated:

| Purpose | Default host directory | Override |
| --- | --- | --- |
| SQLite database and local media | `/data/minidrama-data` | `MINIDRAMA_DATA_DIR` |
| Compressed backups | `/data/minidrama-backups` | `MINIDRAMA_BACKUP_DIR` |

The Compose service mounts the data directory at `/app/backend-node/data`. Do not point either directory inside the Git checkout: replacing or re-cloning the checkout must not change asset IDs, project records, or local media files.

## Deploy safely

`release-deploy` verifies that all tracked media is already in OSS, takes an online SQLite snapshot for the release, and runs migrations plus a preflight container against a copy of it. This keeps a source-code release independent of the size of the local media hot replica. A mismatched mount or an unsynchronised media record stops the deployment instead of serving incomplete data.

Release artifacts are collected after every successful deploy, but only for directories `prepare_source` created itself: each one carries a `.gc-stamp` file, and collection skips anything without it. Among stamped releases, the newest `MINIDRAMA_KEEP_RELEASES` successful ones (5 by default) survive together with any release named by `active-revision` or `rollback.env`; a kept release loses only its reproducible `preflight-data/` copy, and a superseded one is removed with its pre-release database. Release directories that predate the stamp, including every preview checkout, stay untouched until an operator runs the explicit backlog pass:

```bash
bash deploy/prune-release-backlog          # reports counts and sizes, deletes nothing
bash deploy/prune-release-backlog --confirm
```

`prune_release_artifacts` in `lib.sh` implements the policy. A release that never wrote its `succeeded` marker holds no slot in the keep window, and its `production-before.db` is the only surviving copy of the state before that attempt, so collection keeps the database and drops only `source/` and `preflight-data/` for it.

Full SQLite + local-media archives are created by the persistent `minidrama-full-backup.timer` at 03:30 Asia/Shanghai (with up to a ten-minute jitter). Production retains the newest 2 full archives through `FULL_BACKUP_RETAIN_COUNT`.

The timer runs `/usr/local/lib/richidrama-deploy/backup-data.sh`, the copy `install-operations` writes on every successful release, so the nightly script always matches a released revision. It must never point back at the checkout: a manual `git checkout` there swaps the backup logic with no release and no CI signal (2026-09-29: an unreviewed working tree made every nightly run fail with `unknown shorthand flag: 'T' in -T`). A server that still runs the checkout copy switches over once, **after** the release that installed the managed copy:

```bash
install -m 0644 /data/apps/LocalMiniDrama/deploy/minidrama-full-backup.service \
  /etc/systemd/system/minidrama-full-backup.service
systemctl daemon-reload
systemctl start minidrama-full-backup.service
systemctl show -p ExecMainStatus minidrama-full-backup.service   # 0, and a new archive must appear
systemctl list-timers minidrama-full-backup.timer
```

Switching the unit before `/usr/local/lib/richidrama-deploy/backup-data.sh` exists fails with `203/EXEC` on the next run. `restore-data.sh` is installed alongside it, so a restore can run the reviewed revision of the same pair.

Each archive carries one verified online snapshot of the database instead of the live file plus its write-ahead log, and it skips the deployment scratch directories inside the data mount. `backup-data.sh --release` still creates the compact release snapshot archive (30 retained) for manual use. OSS remains the durable media tier.

Two probe outcomes are handled explicitly. When the Docker daemon answers but no RichiDrama container exists, the database is idle and its files are archived as they are, after which the archive is certified. When the daemon cannot be reached at all, the run refuses to produce an archive, because it cannot tell whether the database is being written; `--allow-unverified-database` creates the archive and then keeps every previous one instead of applying retention.

Archives are zstandard (`.tar.zst`) when the host provides `zstd` and gzip (`.tar.gz`) otherwise; `restore-data.sh` selects the decompressor from the suffix, stops the container whether it runs under `docker run` or Compose, and validates before it destroys anything: the compressed stream is tested, the whole member list is read, and the extracted database must pass `PRAGMA integrity_check` through the first available checker (the `sqlite3` command, the checkout's own better-sqlite3, then the application container). `--skip-database-check` restores anyway when an operator accepts that risk; when no checker exists at all the script falls back to the file header and says so. A full backup that cannot certify its own database is deleted again instead of being left to displace the previous archive during retention.

On its first run after this upgrade, the deployment script detects the former `./volumes/data` directory and copies it into the new data directory before switching the mount. Do not move or delete that legacy directory manually; retain it until the deployment log reports `旧数据迁移完成` and the application has been verified.

```bash
cd /data/apps/LocalMiniDrama
bash deploy.sh
```

For a manual backup:

```bash
MINIDRAMA_DATA_DIR=/data/minidrama-data \
MINIDRAMA_BACKUP_DIR=/data/minidrama-backups \
bash deploy/backup-data.sh --full
```

## Restore

Choose an archive from `/data/minidrama-backups`. Restore stops the app, replaces the complete data directory, and starts the app again, so it requires an explicit confirmation:

```bash
bash deploy/restore-data.sh \
  /data/minidrama-backups/minidrama-data-YYYYMMDDTHHMMSSZ.tar.gz \
  --confirm
```

For a manual migration (only needed when changing to a different custom data directory later), copy the existing volume once:

```bash
mkdir -p /data/minidrama-data
rsync -aHAX /data/apps/LocalMiniDrama/volumes/data/ /data/minidrama-data/
```

Then deploy normally. Do not delete the old directory until the application and a backup have been verified.
