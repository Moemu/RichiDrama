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
  // The preview application joins the PRODUCTION docker network with a per-PR
  // alias — no parallel network, no isolated sandbox topology.
  assert.match(source, /--network "\$PROD_PROXY_NETWORK" --network-alias "pr-\$PR_NUMBER"/);
  assert.doesNotMatch(
    source + library,
    /ANCHOR_CONTAINER|ip route del default|NET_ADMIN|"container:\$|GATEWAY_CONTAINER|ensure_preview_edge\b|PREVIEW_NETWORK|media-proxy|static_missing_mode|remote_read_base/
  );
  // Previews are HTTP-only: no certificate machinery may return.
  assert.doesNotMatch(source + library + vhost, /certbot|letsencrypt|TLS_PROXY_NETWORK|TLS_NGINX_CONTAINER|listen 443/);
  // Production-identical behaviour includes the production environment file —
  // the same storage backend, the same credentials, the same integrations.
  assert.match(source, /--env-file "\$ENV_FILE"/);
  assert.match(source, /require_env_file/);
  assert.match(source, /MINIDRAMA_PROFILE=preview/);
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
  assert.match(library, /mv "\$stale" "\$disabled"/);
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
  // The vhost enforces authentication at the shared ingress; every preview
  // application is reachable through the same mechanism as production.
  assert.match(vhost, /auth_basic "RichiDrama PR Preview"/);
  assert.match(vhost, /auth_basic_user_file \/etc\/nginx\/minidrama-preview\.htpasswd/);
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
  assert.match(source, /verify_migrations/);
  assert.match(source, /wait_container_ready.*90/);
  assert.match(source, /--network "\$PROD_PROXY_NETWORK" --network-alias minidrama-app/);
  assert.match(source, /validate_production_ingress/);
  assert.doesNotMatch(source, /sync_production_nginx/);
  assert.match(library, /count=.*server_name/);
  assert.match(library, /getent hosts minidrama-app/);
  assert.match(source, /rollback_now/);
  assert.match(library, /local image="\$1" sha="\$2" data_dir="\$3"\s+local name="minidrama-preflight-/);
  assert.match(library, /docker build[^\n]*\|\| \\/);
  assert.match(library, /fail "Immutable image build failed/);
  assert.match(library, /MINIDRAMA_PULL_BASE_IMAGES/);
  assert.match(library, /docker build "\$\{pull_args\[@\]\}" --build-arg/);
  assert.doesNotMatch(library, /docker build --pull/);
  assert.match(dockerfile, /mirrors\.aliyun\.com/);
  assert.match(dockerfile, /npm ci --include=dev --no-audit --no-fund/);
  assert.match(source, /MINIDRAMA_OBSERVATION_SECONDS:-60/);
  assert.doesNotMatch(source + compatibility, /git reset|git remote set-url/);
});

test('GitHub workflows gate preview and production', () => {
  const validation = read('.github/workflows/validation.yml');
  const preview = read('.github/workflows/preview.yml');
  const cleanup = read('.github/workflows/preview-cleanup.yml');
  const production = read('.github/workflows/deploy.yml');
  assert.match(validation, /node --test test\/\*\.test\.js/);
  assert.match(validation, /docker build --build-arg/);
  assert.match(validation, /shellcheck -e SC1091/);
  assert.match(validation, /Verify preview Nginx configuration/);
  assert.match(validation, /nginx-preview-vhost\.conf/);
  assert.match(validation, /1\.27-alpine nginx -t/);
  assert.match(preview, /pull_request_target/);
  assert.match(preview, /types: \[opened, synchronize, reopened\]/);
  assert.match(preview, /environment: preview/);
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
