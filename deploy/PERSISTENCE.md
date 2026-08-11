# Production data persistence

Application code and production data are deliberately separated:

| Purpose | Default host directory | Override |
| --- | --- | --- |
| SQLite database and local media | `/data/minidrama-data` | `MINIDRAMA_DATA_DIR` |
| Compressed backups | `/data/minidrama-backups` | `MINIDRAMA_BACKUP_DIR` |

The Compose service mounts the data directory at `/app/backend-node/data`. Do not point either directory inside the Git checkout: replacing or re-cloning the checkout must not change asset IDs, project records, or local media files.

## Deploy safely

`deploy.sh` creates the directories, checkpoints SQLite WAL when the app is running, saves a timestamped archive before every deployment, retains the newest 14 archives, and then verifies the running container mount source. A mismatched mount stops the deployment instead of serving an empty database.

On its first run after this upgrade, the deployment script detects the former `./volumes/data` directory and copies it into the new data directory before switching the mount. Do not move or delete that legacy directory manually; retain it until the deployment log reports `旧数据迁移完成` and the application has been verified.

```bash
cd /data/apps/LocalMiniDrama
bash deploy.sh
```

For a manual backup:

```bash
MINIDRAMA_DATA_DIR=/data/minidrama-data \
MINIDRAMA_BACKUP_DIR=/data/minidrama-backups \
bash deploy/backup-data.sh
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
