const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('preview deployment isolates data, network and resources', () => {
  const source = read('deploy/preview-deploy');
  const gateway = read('deploy/preview-gateway.conf.template');
  assert.match(source, /docker network create --internal/);
  assert.match(source, /--network "\$NETWORK" --network-alias preview-app/);
  assert.match(source, /--memory 2g --cpus 1/);
  assert.match(source, /--pids-limit 256/);
  assert.match(source, /-v "\$DATA_DIR:\/app\/backend-node\/data"/);
  assert.doesNotMatch(source, /-v "\$PROD_DATA_DIR:\/app\/backend-node\/data"/);
  assert.match(gateway, /auth_basic_user_file/);
  assert.match(source, /preview\.drama\.richbest\.cn/);
});

test('preview removal validates the exact PR path', () => {
  const source = read('deploy/lib.sh');
  assert.match(source, /resolved_target.*resolved_root\/pr-\$pr/);
  assert.match(source, /label=com\.richidrama\.preview-pr/);
  assert.match(source, /rm -rf -- "\$resolved_target"/);
});

test('production release uses an immutable archive and rollback container', () => {
  const source = read('deploy/release-deploy');
  const compatibility = read('deploy.sh');
  assert.match(source, /prepare_source "\$SHA"/);
  assert.match(source, /verify_migrations/);
  assert.match(source, /wait_container_ready.*90/);
  assert.match(source, /rollback_now/);
  assert.match(source, /MINIDRAMA_OBSERVATION_SECONDS:-300/);
  assert.doesNotMatch(source + compatibility, /git reset|git remote set-url/);
});

test('GitHub workflows gate preview and production', () => {
  const validation = read('.github/workflows/validation.yml');
  const preview = read('.github/workflows/preview.yml');
  const production = read('.github/workflows/deploy.yml');
  assert.match(validation, /node --test test\/\*\.test\.js/);
  assert.match(validation, /docker build --build-arg/);
  assert.match(preview, /environment: preview/);
  assert.match(preview, /preview \/ smoke/);
  assert.match(preview, /head\.repo\.full_name/);
  assert.match(production, /environment: production/);
  assert.match(production, /workflow_run\.conclusion == 'success'/);
  const protection = read('deploy/configure-github-protection');
  assert.match(protection, /preview \/ smoke/);
  assert.match(protection, /"enforce_admins": true/);
  assert.match(protection, /required_approving_review_count.*1/);
});
