const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('preview deployment isolates data, network, secrets and resources', () => {
  const source = read('deploy/preview-deploy');
  const library = read('deploy/lib.sh');
  const previewDockerfile = read('Dockerfile.preview');
  const passthrough = read('deploy/nginx-previews-passthrough.conf');
  const edge = read('deploy/nginx-preview-edge.conf');
  assert.match(source, /build_preview_image "\$SHA" "\$SOURCE_DIR"/);
  assert.match(library, /docker inspect --format '\{\{\.Image\}\}' "\$PROD_CONTAINER"/);
  assert.match(library, /RUNTIME_BASE_IMAGE=\$base_tag/);
  assert.match(previewDockerfile, /FROM \$\{RUNTIME_BASE_IMAGE\} AS runtime/);
  const previewRuntime = previewDockerfile.split('FROM ${RUNTIME_BASE_IMAGE} AS runtime')[1];
  assert.doesNotMatch(previewRuntime, /apt-get|dnf|yum/);
  // One shared internal network replaces per-deploy namespace surgery.
  assert.match(library, /docker network create --internal "\$PREVIEW_NETWORK"/);
  assert.match(source, /ensure_preview_network/);
  assert.match(source, /--network "\$PREVIEW_NETWORK" --network-alias "pr-\$PR_NUMBER"/);
  assert.doesNotMatch(
    source + library,
    /ANCHOR_CONTAINER|ip route del default|NET_ADMIN|"container:\$|GATEWAY_CONTAINER/
  );
  // Previews are HTTP-only: no certificate machinery may return.
  assert.doesNotMatch(source + library + edge + passthrough, /certbot|letsencrypt|TLS_PROXY_NETWORK|TLS_NGINX_CONTAINER|listen 443/);
  // Production secrets never reach preview code.
  assert.doesNotMatch(source, /--env-file/);
  assert.match(source, /MINIDRAMA_STORAGE_TYPE=local/);
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
});

test('preview edge is the only dual-homed component and cannot pivot', () => {
  const source = read('deploy/preview-deploy');
  const library = read('deploy/lib.sh');
  const passthrough = read('deploy/nginx-previews-passthrough.conf');
  const edge = read('deploy/nginx-preview-edge.conf');
  assert.match(source, /install_preview_http_ingress "\$SOURCE_DIR\/deploy\/nginx-previews-passthrough\.conf" "\$SOURCE_DIR\/deploy\/nginx-preview-edge\.conf"/);
  assert.match(library, /PREVIEW_EDGE_CONTAINER=/);
  assert.match(library, /ensure_preview_edge/);
  // The edge enforces authentication; the outer passthrough carries none, so
  // it can never leak credentials nor be talked into proxying elsewhere.
  assert.match(edge, /auth_basic "RichiDrama PR Preview"/);
  assert.match(edge, /auth_basic_user_file \/etc\/nginx\/minidrama-preview\.htpasswd/);
  assert.doesNotMatch(passthrough, /auth_basic/);
  assert.match(edge, /listen 8080 default_server/);
  assert.match(edge, /return 404/);
  assert.match(edge, /resolver 127\.0\.0\.11/);
  // The routed hostname carries the literal pr- prefix; a digits-only match
  // silently falls through to the rejection block (regression 2026-08-26).
  assert.match(edge, /server_name "~\^pr-\(\?<preview_pr>\[0-9]\+\)\\\.preview\\\.drama/);
  assert.match(edge, /proxy_pass http:\/\/pr-\$preview_pr:5679/);
  assert.match(passthrough, /set \$preview_edge_upstream http:\/\/minidrama-preview-edge:8080/);
  assert.match(source, /PREVIEW_EDGE_CONTAINER.*wget/);
  assert.match(source, /pr-\$\{PR_NUMBER\}\.preview\.drama\.richbest\.cn/);
  // Legacy layouts that hijacked or bypassed the edge must be purged.
  assert.match(library, /rm -f \/etc\/nginx\/conf\.d\/minidrama-preview-http\.conf/);
  assert.match(library, /rm -f \/etc\/nginx\/conf\.d\/minidrama-previews\.conf/);
});

test('preview removal validates the exact PR path', () => {
  const source = read('deploy/lib.sh');
  assert.match(source, /resolved_target.*resolved_root\/pr-\$pr/);
  assert.match(source, /label=com\.richidrama\.preview-pr/);
  assert.match(source, /rm -rf -- "\$resolved_target"/);
  assert.ok(source.indexOf('preview-pr-$pr.conf') < source.indexOf('docker rm -f "${preview_containers[@]}"'));
  assert.doesNotMatch(read('deploy/preview-remove') + source, /certbot delete/);
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
  assert.match(library, /docker build --pull --build-arg/);
  assert.doesNotMatch(dockerfile, /mirrors\.aliyun\.com/);
  assert.match(source, /MINIDRAMA_OBSERVATION_SECONDS:-300/);
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
  assert.match(validation, /nginx-preview-edge\.conf/);
  assert.match(validation, /nginx-previews-passthrough\.conf/);
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
  assert.match(production, /environment: production/);
  assert.match(production, /workflow_run\.conclusion == 'success'/);
  assert.match(production, /Remove transferred source/);
  const protection = read('deploy/configure-github-protection');
  assert.match(protection, /preview \/ smoke/);
  assert.match(protection, /"enforce_admins": true/);
  assert.match(protection, /REQUIRED_APPROVALS="\$\{2:-0\}"/);
  assert.match(protection, /1\) REQUIRE_LAST_PUSH_APPROVAL=true/);
  assert.match(protection, /required_approving_review_count.*REQUIRED_APPROVALS/);
  assert.match(read('.gitattributes'), /backend-node\/tools\/ffmpeg\/ffmpeg\.exe export-ignore/);
});
