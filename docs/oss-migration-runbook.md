# OSS media migration runbook

## Compatibility contract

`local_path` remains the stable media key. Migration uploads each file to
`<prefix>/<local_path>` without changing database rows. Existing clients keep
using `/static/<local_path>`: the backend serves a local file while it exists,
then redirects the same path to `public_base_url` after migration. Old assets,
storyboards, rendered videos, and export references therefore require no data
rewrite.

## Safe rollout

1. Create an OSS bucket and a CDN/custom domain. Grant an access key only
   `PutObject`, `GetObject`, and (if required) `ListBucket` inside this prefix.
   The production Compose file reads these values from `MINIDRAMA_OSS_*`, which
   intentionally mirrors the Lens OSS pattern while retaining a service prefix.
2. Configure the running service with environment variables, never by putting
   credentials into `config.yaml`:

   ```powershell
   $env:CFG_STORAGE__TYPE='oss'
   $env:CFG_STORAGE__OSS__ENDPOINT='https://oss-cn-<region>.aliyuncs.com'
   $env:CFG_STORAGE__OSS__BUCKET='<bucket>'
   $env:CFG_STORAGE__OSS__ACCESS_KEY_ID='<access-key-id>'
   $env:CFG_STORAGE__OSS__ACCESS_KEY_SECRET='<access-key-secret>'
   $env:CFG_STORAGE__OSS__PREFIX='local-mini-drama'
   $env:CFG_STORAGE__OSS__PUBLIC_BASE_URL='https://media.example.com'
   ```

3. On a copy/snapshot of the production storage volume, run the inventory:

   ```powershell
   cd backend-node
   node src/scripts/migrateMediaToOss.js --dry-run
   ```

4. Run the migration without deletion, sample historical image/video
   `/static/` URLs, create one new SD2 video, and run one project export.
5. Run with `--remove-local`. A file is deleted only after a successful OSS
   response; failed files remain local and are reported for retry.
6. Keep local serving enabled for a rollback window. To roll back, change only
   `CFG_STORAGE__TYPE` back to `local`; no database restoration is needed for
   files retained locally. For files already removed, re-run migration from an
   OSS restore job before making the service local-only.

`auto_archive_enabled` must remain `false` during steps 2–4. It is only set to
`true` after the explicit migration has succeeded; this prevents a fresh OSS
deployment from asynchronously deleting historical local media before review.

## Operational boundaries

- OSS/CDN reduces disk pressure and media delivery latency. It does not reduce
  the upstream video-model generation time.
- New videos are archived before completion. Other settled images, audio, and
  uploaded media are swept to OSS after five minutes; fresh files stay local so
  post-processing is never raced.
- Completed videos are archived to OSS before being marked completed. An
  upload failure leaves the generation failed/retryable instead of saving an
  expiring vendor URL.
- The migration command is idempotent: object keys are deterministic, and any
  failed local file can be retried safely.
- `--remove-local` and the automatic sweep require `public_base_url`; the
  application refuses deletion without a CDN/public delivery route.
