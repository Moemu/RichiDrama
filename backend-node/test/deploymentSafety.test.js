const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('preview deployment is production-identical except dataset and title', () => {
  const source = read('deploy/preview-deploy');
  const library = read('deploy/lib.sh');
  const previewDockerfile = read('Dockerfile.preview');
  const vhost = read('deploy/nginx-preview-vhost.conf');
  assert.match(source, /build_preview_image "\$SHA" "\$SOURCE_DIR"/);
  assert.match(library, /docker inspect --format '\{\{\.Image\}\}' "\$PROD_CONTAINER"/);
  assert.match(library, /RUNTIME_BASE_IMAGE=\$base_tag/);
  assert.match(previewDockerfile, /FROM \$\{RUNTIME_BASE_IMAGE\} AS runtime/);
  const previewRuntime = previewDockerfile.split('FROM ${RUNTIME_BASE_IMAGE} AS runtime')[1];
  assert.doesNotMatch(previewRuntime, /apt-get|dnf|yum/);
  assert.match(previewRuntime, /COPY --from=builder \/usr\/local\/bin\/node \/usr\/local\/bin\/node/);
  // The preview application joins the PRODUCTION docker network with a per-PR
  // alias — no parallel network, no isolated sandbox topology.
  assert.match(source, /--network "\$PROD_PROXY_NETWORK" --network-alias "pr-\$PR_NUMBER"/);
  assert.doesNotMatch(
    source + library,
    /ANCHOR_CONTAINER|ip route del default|NET_ADMIN|"container:\$|GATEWAY_CONTAINER|ensure_preview_edge\b|PREVIEW_NETWORK|media-proxy|static_missing_mode|remote_read_base/
  );
  // Previews are HTTP-only: no certificate machinery may return.
  assert.doesNotMatch(source + library + vhost, /certbot|letsencrypt|TLS_PROXY_NETWORK|TLS_NGINX_CONTAINER|listen 443/);
  // Preview selects a profile-specific ignored environment file. The resolver
  // keeps the legacy server path as a compatibility fallback.
  assert.match(source, /--env-file "\$ENV_FILE"/);
  assert.match(source, /require_env_file preview/);
  assert.match(library, /\/data\/minidrama-config\/\.\$\{profile\}\.env/);
  assert.match(library, /\/data\/minidrama-config\/minidrama\.oss\.env/);
  assert.match(source, /MINIDRAMA_PROFILE=preview/);
  assert.match(source, /CFG_PAYMENTS__MIN_AMOUNT_FEN=1/);
  assert.doesNotMatch(source, /MINIDRAMA_STORAGE_TYPE|static_missing_mode|remote_read_base/);
  // The retired security-theatre machinery must stay retired.
  assert.doesNotMatch(source + library, /media-proxy|nginx-preview-edge/);
  // Migration safety against the current production snapshot is mandatory.
  assert.match(source, /create_online_snapshot "\$DATA_DIR\/drama_generator\.db"/);
  assert.match(source, /verify_migrations "\$IMAGE" "\$DATA_DIR"/);
  assert.match(source, /wait_container_ready "\$APP_CONTAINER" "\$SHA" 90/);
  assert.match(source, /--memory 2g --cpus 1/);
  assert.match(source, /--pids-limit 256/);
  assert.match(source, /-v "\$DATA_DIR:\/app\/backend-node\/data"/);
  assert.doesNotMatch(source, /-v "\$PROD_DATA_DIR:\/app\/backend-node\/data"/);
  // Preview deploys only inspect production ingress; they never migrate it.
  assert.match(source, /acquire_lock\nvalidate_production_ingress_readonly/);
  assert.match(library, /validate_production_ingress\(\)/);
  assert.match(library, /active=.*nginx -T/);
  assert.doesNotMatch(library, /mv "\$stale" "\$disabled"/);
  // Candidate images must be pruned on every successful preview.
  assert.match(source, /prune_release_images/);
  // Media tree fidelity: an OverlayFS union view mounts the real production
  // hot-copy tree under the container storage path — legacy uploads exist
  // ONLY there, so production-identical behaviour requires the view. Writes
  // and deletions land in the preview-private upper directory.
  assert.match(library, /ensure_preview_media_tree/);
  assert.match(library, /"lowerdir=\$lower,upperdir=\$upper,workdir=\$work"/);
  assert.match(library, /umount -l "\$view"/);
  assert.match(source, /MEDIA_TREE="\$\(ensure_preview_media_tree "\$PR_DIR"\)"/);
  assert.match(source, /-v "\$MEDIA_TREE:\/app\/backend-node\/data\/storage"/);
  // Title badge: the single permitted page-level difference, build-time only.
  assert.match(previewDockerfile, /PREVIEW_TITLE_BADGE/);
  assert.match(previewDockerfile, /\(preview\)<\/title>/);
  assert.match(library, /PREVIEW_TITLE_BADGE=1/);
  const prodDockerfile = read('Dockerfile');
  assert.doesNotMatch(prodDockerfile, /PREVIEW_TITLE_BADGE/);
});

test('preview vhost authenticates and routes like production would', () => {
  const source = read('deploy/preview-deploy');
  const library = read('deploy/lib.sh');
  const vhost = read('deploy/nginx-preview-vhost.conf');
  assert.match(source, /install_preview_ingress "\$SOURCE_DIR\/deploy\/nginx-preview-vhost\.conf"/);
  assert.match(library, /install_preview_ingress/);
  assert.match(library, /docker cp "\$auth_dir\/htpasswd" "\$HTTP_NGINX_CONTAINER:\/etc\/nginx\/minidrama-preview\.htpasswd"/);
  assert.match(library, /chmod 0644 \/etc\/nginx\/minidrama-preview\.htpasswd/);
  // The vhost enforces authentication at the shared ingress; every preview
  // application is reachable through the same mechanism as production.
  assert.match(vhost, /auth_basic "RichiDrama PR Preview"/);
  assert.match(vhost, /auth_basic_user_file \/etc\/nginx\/minidrama-preview\.htpasswd/);
  const wechatCallback = vhost.match(/location = \/api\/v1\/payments\/callbacks\/wechat \{([\s\S]*?)\n    \}/);
  assert.ok(wechatCallback, 'Preview must define an exact WeChat callback location.');
  assert.match(wechatCallback[1], /auth_basic off/);
  assert.match(wechatCallback[1], /proxy_pass http:\/\/pr-\$preview_pr:5679/);
  const gatewayCallback = vhost.match(/location = \/minidrama\/payments\/callbacks\/wechat \{([\s\S]*?)\n    \}/);
  assert.ok(gatewayCallback, 'Preview must define the fixed HTTPS gateway callback path.');
  assert.match(gatewayCallback[1], /auth_basic off/);
  assert.match(gatewayCallback[1], /proxy_pass http:\/\/pr-\$preview_pr:5679\/api\/v1\/payments\/callbacks\/wechat/);
  assert.match(source, /minidrama\/payments\/callbacks\/wechat/);
  assert.match(source, /WWW-Authenticate/);
  assert.match(vhost, /location \/ \{/);
  assert.match(vhost, /resolver 127\.0\.0\.11/);
  // The routed hostname carries the literal pr- prefix; a digits-only match
  // silently falls through to the rejection block (regression 2026-08-27).
  assert.match(vhost, /server_name "~\^pr-\(\?<preview_pr>\[0-9]\+\)\\\.preview\\\.drama/);
  assert.match(vhost, /proxy_pass http:\/\/pr-\$preview_pr:5679/);
  assert.match(source, /pr-\$\{PR_NUMBER\}\.preview\.drama\.richbest\.cn/);
  // Legacy layouts that hijacked or duplicated routing must be purged.
  assert.match(library, /minidrama-preview-http\.conf/);
  assert.match(library, /minidrama-previews\.conf/);
  assert.match(library, /minidrama-previews-ingress\.conf/);
});

test('preview removal validates the exact PR path', () => {
  const source = read('deploy/lib.sh');
  assert.match(source, /resolved_target.*resolved_root\/pr-\$pr/);
  assert.match(source, /label=com\.richidrama\.preview-pr/);
  assert.match(source, /rm -rf -- "\$resolved_target"/);
  assert.ok(source.indexOf('preview-pr-$pr.conf') < source.indexOf('docker rm -f "${preview_containers[@]}"'));
  assert.doesNotMatch(source, /certbot delete/);
});

test('production release uses an immutable archive and rollback container', () => {
  const source = read('deploy/release-deploy');
  const compatibility = read('deploy.sh');
  const library = read('deploy/lib.sh');
  const dockerfile = read('Dockerfile');
  assert.match(source, /prepare_source "\$SHA"/);
  assert.match(source, /require_env_file prod/);
  assert.match(source, /verify_migrations/);
  assert.match(source, /wait_container_ready.*90/);
  assert.match(source, /--network "\$PROD_PROXY_NETWORK" --network-alias minidrama-app/);
  assert.match(source, /validate_production_ingress/);
  assert.doesNotMatch(source, /sync_production_nginx/);
  assert.match(library, /count=.*server_name/);
  assert.match(library, /active=.*nginx -T/);
  assert.doesNotMatch(library, /grep -Eq .*server_name.*default\.conf/);
  assert.doesNotMatch(library, /mv "\$stale"/);
  assert.match(library, /getent hosts minidrama-app/);
  assert.match(source, /rollback_now/);
  // Release artifacts must be collected. Every commit that reached CI used to
  // leave an unpacked source tree and two database copies behind.
  assert.match(source, /MINIDRAMA_GC_CURRENT_SHA="\$SHA" prune_release_artifacts/);
  assert.match(read('deploy/preview-deploy'), /MINIDRAMA_GC_CURRENT_SHA="\$SHA" prune_release_artifacts/);
  assert.match(library, /prune_release_artifacts\(\)/);
  assert.match(library, /release_is_referenced/);
  assert.match(library, /-name succeeded -printf '%T@ %h/);
  assert.match(library, /find "\$\{PROD_DATA_DIR\}\/\.deploy-snapshots".*-delete/);
  assert.match(library, /local image="\$1" sha="\$2" data_dir="\$3"\s+local name="minidrama-preflight-/);
  assert.match(library, /docker build[^\n]*\|\| \\/);
  assert.match(library, /fail "Immutable image build failed/);
  assert.match(library, /MINIDRAMA_PULL_BASE_IMAGES/);
  assert.match(library, /docker build "\$\{pull_args\[@\]\}" --build-arg/);
  assert.doesNotMatch(library, /docker build --pull/);
  assert.match(dockerfile, /mirrors\.aliyun\.com/);
  assert.match(dockerfile, /ARG DEBIAN_MIRROR=mirrors\.aliyun\.com/);
  assert.match(dockerfile, /--mount=type=cache,id=richidrama-builder-apt-lists/);
  assert.match(dockerfile, /--mount=type=cache,id=richidrama-runtime-apt-lists/);
  const runtimeStage = dockerfile.split('FROM node:24-bookworm-slim AS runtime')[1];
  assert.ok(runtimeStage.indexOf('ARG APP_REVISION') > runtimeStage.indexOf('apt-get install'));
  assert.match(dockerfile, /npm ci --include=dev --no-audit --no-fund/);
  assert.match(source, /MINIDRAMA_OBSERVATION_SECONDS:-60/);
  assert.match(source, /"\$code" == 401 \|\| "\$code" == 404/);
  assert.doesNotMatch(source + compatibility, /git reset|git remote set-url/);
});

test('nightly backup snapshots the database instead of tarring a live one', () => {
  const backup = read('deploy/backup-data.sh');
  const restore = read('deploy/restore-data.sh');
  const backlog = read('deploy/prune-release-backlog');
  const library = read('deploy/lib.sh');
  // Production starts the container with `docker run`, so the Compose probe must
  // never be the only way to find the live application.
  assert.match(backup, /RUNTIME_KIND='docker'/);
  assert.ok(backup.indexOf('docker info') < backup.indexOf('docker inspect'));
  assert.match(backup, /db\.backup\(process\.env\.SNAPSHOT_TARGET\)/);
  assert.match(backup, /integrity_check/);
  // One consistent database copy, and no deployment scratch from the data mount.
  assert.match(backup, /--exclude='\*\.db-wal'/);
  assert.match(backup, /--exclude='\.\/\.deploy-snapshots'/);
  assert.match(backup, /--exclude='\.\/\.manual-backups'/);
  assert.match(backup, /-C "\$\{HOST_STAGE\}" drama_generator\.db/);
  assert.match(backup, /trap cleanup_stage EXIT/);
  // An inconclusive runtime probe may not silently produce the newest backup.
  assert.match(backup, /--allow-unverified-database/);
  assert.match(backup, /Keeping every previous archive/);
  // Only the documented media races may be reported; any other tar diagnostic,
  // and anything about the database itself, invalidates the archive.
  assert.match(backup, /TOLERABLE_TAR_DIAGNOSTICS='/);
  assert.match(backup, /grep -q 'drama_generator\\\.db' -- "\$\{diagnostics\}"/);
  // zstandard when available, gzip otherwise, in both directions.
  assert.match(backup, /zstd -T0 -3/);
  assert.match(backup, /-name "\$\{prefix\}\*\.tar\.zst"/);
  assert.match(backup, /RELEASE_BACKUP_RETAIN_COUNT:-30/);
  assert.match(restore, /\*\.tar\.zst\)/);
  assert.match(restore, /Archive integrity check failed/);
  assert.ok(restore.indexOf('Archive integrity check failed') < restore.indexOf('find "${DATA_DIR}" -mindepth 1'),
    'a restore must validate the archive before it removes the live data');
  assert.match(restore, /docker stop --time 20 "\$\{APP_CONTAINER\}"/);
  assert.match(restore, /RUNTIME_KIND='compose'/);
  // An archive whose database cannot be certified is discarded, so it can never
  // be counted against retention by the next successful run.
  assert.match(backup, /Backup discarded/);
  // A restore must prove the database is readable, not merely SQLite-shaped.
  assert.match(restore, /PRAGMA integrity_check/);
  assert.match(restore, /failed its integrity check/);
  assert.match(restore, /--skip-database-check/);
  // Retrying an older SHA must not make a history directory collectible.
  assert.match(library, /if mkdir "\$\{RELEASE_ROOT\}\/\$\{sha\}" 2>\/dev\/null; then/);
  // An aborted release never wrote its success marker, so it holds no keep slot;
  // its pre-release database is the only copy and must survive collection.
  assert.match(library, /elif \[\[ -f "\$\{dir\}\/production-before\.db" && ! -f "\$\{dir\}\/succeeded" \]\]; then/);
  assert.match(library, /rm -rf -- "\$\{dir\}\/source" "\$\{dir\}\/preflight-data"/);
  // Pre-policy release directories are history: collecting them is a separate,
  // confirmed operation, and the nightly and release paths never do it.
  assert.match(library, /release_is_collectible/);
  assert.match(backlog, /require_root/);
  assert.match(backlog, /--confirm/);
  assert.match(backlog, /MINIDRAMA_GC_INCLUDE_LEGACY=1/);
  assert.doesNotMatch(read('deploy/release-deploy') + read('deploy/preview-deploy'), /MINIDRAMA_GC_INCLUDE_LEGACY/);
});

test('GitHub workflows gate preview and production', () => {
  const validation = read('.github/workflows/validation.yml');
  const preview = read('.github/workflows/preview.yml');
  const cleanup = read('.github/workflows/preview-cleanup.yml');
  const production = read('.github/workflows/deploy.yml');
  assert.match(validation, /node --test test\/\*\.test\.js/);
  assert.match(validation, /docker\/setup-buildx-action@v4/);
  assert.match(validation, /docker\/build-push-action@v7/);
  assert.match(validation, /cache-from: type=gha,scope=validation-container/);
  assert.match(validation, /cache-to: type=gha,mode=max,scope=validation-container/);
  assert.match(validation, /DEBIAN_MIRROR=deb\.debian\.org/);
  assert.match(validation, /load: true/);
  assert.match(validation, /shellcheck -e SC1091/);
  assert.match(validation, /Verify preview Nginx configuration/);
  assert.match(validation, /nginx-preview-vhost\.conf/);
  assert.match(validation, /1\.27-alpine nginx -t/);
  // Previews chain after Validation (validation -> preview): the smoke deploy
  // runs only for a non-main branch once the Validation run of the same head
  // commit has succeeded.
  assert.match(preview, /workflow_run:\n    workflows: \[Validation\]/);
  assert.match(preview, /types: \[completed\]/);
  assert.match(preview, /workflow_run\.conclusion == 'success'/);
  assert.match(preview, /head_branch != 'main'/);
  assert.doesNotMatch(preview, /pull_request_target/);
  // The deployment record must be created explicitly against the PR head
  // branch: a job-level `environment:` anchors it to main (workflow_run runs
  // are attributed to the default branch) and PR pages would report the
  // branch as never deployed.
  assert.doesNotMatch(preview, /environment: preview/);
  assert.match(preview, /deployments: write/);
  assert.match(preview, /POST "repos\/\$\{GITHUB_REPOSITORY\}\/deployments" --input -/);
  assert.match(preview, /environment:"preview",auto_merge:false,required_contexts:\[\]/);
  assert.match(preview, /deployments\/\$\{deployment_id\}\/statuses" -f state=in_progress/);
  assert.match(preview, /-f state=success -f auto_inactive=false -f "environment_url=/);
  assert.match(preview, /-f state=failure -f auto_inactive=false/);
  assert.match(preview, /preview \/ smoke/);
  assert.match(preview, /head\.repo\.full_name/);
  assert.match(preview, /author_association/);
  assert.doesNotMatch(preview, /actions\/checkout|scp-action|Upload source archive/);
  assert.match(preview, /git -C "\$repo" fetch --no-tags origin "refs\/pull\/\$\{pr\}\/head"/);
  assert.match(preview, /rev-parse FETCH_HEAD/);
  assert.match(preview, /git -C "\$repo" archive/);
  assert.match(preview, /Remove server-side source/);
  assert.match(preview, /rm -f -- "\$incoming"/);
  assert.match(preview, /rm -rf -- "\$bootstrap"/);
  // Cleanup must not depend on commands installed by a successful deploy.
  assert.match(cleanup, /bash \/data\/apps\/LocalMiniDrama\/deploy\/preview-cleanup/);
  assert.match(cleanup, /bash \/data\/apps\/LocalMiniDrama\/deploy\/preview-remove/);
  assert.match(cleanup, /bash \/usr\/local\/lib\/richidrama-preview\/preview-remove/);
  assert.match(cleanup, /bash \/usr\/local\/lib\/richidrama-preview\/preview-cleanup/);
  // Closed PRs must deactivate exactly their own deployment records;
  // auto_inactive would also deactivate other open PRs' previews.
  assert.match(cleanup, /deployments: write/);
  assert.match(cleanup, /deployments\?environment=preview&sha=/);
  assert.match(cleanup, /-f state=inactive -f auto_inactive=false/);
  assert.match(production, /environment: production/);
  assert.match(production, /workflow_run\.conclusion == 'success'/);
  // Production fetches its own source server-side; the runner ships no bytes.
  assert.doesNotMatch(production, /scp-action|actions\/checkout|Upload source archive/);
  assert.match(production, /rev-parse FETCH_HEAD\)" = "\$sha"/);
  const protection = read('deploy/configure-github-protection');
  assert.match(protection, /preview \/ smoke/);
  assert.match(protection, /"enforce_admins": true/);
  assert.match(protection, /REQUIRED_APPROVALS="\$\{2:-0\}"/);
  assert.match(protection, /1\) REQUIRE_LAST_PUSH_APPROVAL=true/);
  assert.match(protection, /required_approving_review_count.*REQUIRED_APPROVALS/);
  assert.match(read('.gitattributes'), /backend-node\/tools\/ffmpeg\/ffmpeg\.exe export-ignore/);
});
