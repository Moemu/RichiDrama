const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('preview deployment isolates data, network and resources', () => {
  const source = read('deploy/preview-deploy');
  const library = read('deploy/lib.sh');
  const gateway = read('deploy/preview-gateway.conf.template');
  const redirect = read('deploy/nginx-preview-redirect.conf.template');
  const tls = read('deploy/nginx-preview-tls.conf.template');
  const reject = read('deploy/nginx-tls-default-reject.conf');
  const acmeHook = read('deploy/acme-auth-hook.sh');
  assert.match(source, /docker network create --internal/);
  assert.match(source, /require_container_network "\$TLS_NGINX_CONTAINER" "\$TLS_PROXY_NETWORK"/);
  assert.match(source, /docker network connect .*"\$TLS_PROXY_NETWORK"/);
  assert.match(source, /http:\/\/\$GATEWAY_CONTAINER:8080\/ready/);
  assert.doesNotMatch(source + library, /container_network_ip|GATEWAY_PROXY_IP/);
  assert.match(source, /acquire_lock\s+validate_production_ingress/);
  assert.match(source, /docker exec "\$TLS_NGINX_CONTAINER" wget/);
  assert.match(source, /--network "\$NETWORK" --network-alias preview-app/);
  assert.match(source, /--memory 2g --cpus 1/);
  assert.match(source, /--pids-limit 256/);
  assert.match(source, /apt-get install -y --no-install-recommends certbot/);
  assert.match(source, /dnf install -y certbot/);
  assert.match(source, /yum install -y certbot/);
  assert.match(source, /-v "\$DATA_DIR:\/app\/backend-node\/data"/);
  assert.doesNotMatch(source, /-v "\$PROD_DATA_DIR:\/app\/backend-node\/data"/);
  assert.match(gateway, /auth_basic_user_file/);
  assert.match(source, /preview\.drama\.richbest\.cn/);
  assert.doesNotMatch(source, /docker cp -L .*chain\.pem/);
  assert.match(tls, /\/etc\/letsencrypt\/live\/__PREVIEW_HOST__\/fullchain\.pem/);
  assert.match(tls, /proxy_pass http:\/\/__GATEWAY_HOST__:8080/);
  assert.match(redirect, /return 301 https:\/\/\$host\$request_uri/);
  assert.match(reject, /listen 443 ssl default_server/);
  assert.match(reject, /server_names_hash_bucket_size 128/);
  assert.match(reject, /ssl_reject_handshake on/);
  assert.match(library, /HTTP_NGINX_CONTAINER=.*lens-rhyme-nginx-1/);
  assert.match(library, /TLS_NGINX_CONTAINER=.*avatar-proxy-api-gateway-1/);
  assert.match(library, /TLS_PROXY_NETWORK=.*avatar-proxy_default/);
  assert.match(source, /for attempt in 1 2/);
  assert.match(source, /\[preview-host\]/);
  assert.match(source, /MINIDRAMA_HTTP_NGINX_CONTAINER="\$HTTP_NGINX_CONTAINER"/);
  assert.match(acmeHook, /chmod 644 "\$tmp"/);
  assert.match(acmeHook, /chmod 644 .*CERTBOT_TOKEN/);
});

test('preview TLS template renders one exact isolated upstream', () => {
  const template = read('deploy/nginx-preview-tls.conf.template');
  const host = 'pr-3-0123456789abcdef.preview.drama.richbest.cn';
  const rendered = template
    .replaceAll('__PREVIEW_HOST__', host)
    .replaceAll('__GATEWAY_HOST__', 'minidrama-pr-3-token-gateway');
  assert.doesNotMatch(rendered, /__[A-Z_]+__/);
  assert.match(rendered, new RegExp(`server_name ${host.replaceAll('.', '\\.')}`));
  assert.match(rendered, /proxy_pass http:\/\/minidrama-pr-3-token-gateway:8080/);
  assert.doesNotMatch(rendered, /minidrama-app|preview-app/);
});

test('preview removal validates the exact PR path', () => {
  const source = read('deploy/lib.sh');
  assert.match(source, /resolved_target.*resolved_root\/pr-\$pr/);
  assert.match(source, /label=com\.richidrama\.preview-pr/);
  assert.match(source, /rm -rf -- "\$resolved_target"/);
  assert.match(source, /docker exec "\$HTTP_NGINX_CONTAINER" rm -f "\/etc\/nginx\/conf\.d\/preview-pr-\$pr\.conf"/);
  assert.match(source, /docker exec "\$TLS_NGINX_CONTAINER" rm -f "\/etc\/nginx\/conf\.d\/preview-pr-\$pr\.conf"/);
  assert.ok(source.indexOf('preview-pr-$pr.conf') < source.indexOf('docker rm -f "${preview_containers[@]}"'));
});

test('production release uses an immutable archive and rollback container', () => {
  const source = read('deploy/release-deploy');
  const compatibility = read('deploy.sh');
  const library = read('deploy/lib.sh');
  assert.match(source, /prepare_source "\$SHA"/);
  assert.match(source, /verify_migrations/);
  assert.match(source, /wait_container_ready.*90/);
  assert.match(source, /--network "\$PROD_PROXY_NETWORK" --network-alias minidrama-app/);
  assert.match(source, /validate_production_ingress/);
  assert.doesNotMatch(source, /sync_production_nginx/);
  assert.match(library, /mv "\$stale" "\$disabled"/);
  assert.match(library, /count=.*server_name/);
  assert.match(library, /getent hosts minidrama-app/);
  assert.match(source, /rollback_now/);
  assert.match(library, /local image="\$1" sha="\$2" data_dir="\$3"\s+local name="minidrama-preflight-/);
  assert.match(source, /MINIDRAMA_OBSERVATION_SECONDS:-300/);
  assert.doesNotMatch(source + compatibility, /git reset|git remote set-url/);
});

test('GitHub workflows gate preview and production', () => {
  const validation = read('.github/workflows/validation.yml');
  const preview = read('.github/workflows/preview.yml');
  const production = read('.github/workflows/deploy.yml');
  assert.match(validation, /node --test test\/\*\.test\.js/);
  assert.match(validation, /docker build --build-arg/);
  assert.match(validation, /shellcheck -e SC1091/);
  assert.match(validation, /Verify preview TLS Nginx configuration/);
  assert.match(validation, /nginx:1\.27-alpine nginx -t/);
  assert.match(preview, /environment: preview/);
  assert.match(preview, /preview \/ smoke/);
  assert.match(preview, /head\.repo\.full_name/);
  assert.match(preview, /Remove transferred source/);
  assert.match(preview, /rm -f -- "\$incoming"/);
  assert.match(preview, /rm -rf -- "\$bootstrap"/);
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
