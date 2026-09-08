'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { prepareProductionDeploy } = require('./prepare-production-deploy.cjs');

const revision = 'a'.repeat(40);
const repository = 'owner/project';
const root = `/repos/${repository}`;
const pendingPath = id => `${root}/actions/runs/${id}/pending_deployments`;
const production = { environment: { id: 7, name: 'production' }, current_user_can_approve: true };
const run = (id, extra = {}) => ({ id, run_number: id, status: 'waiting', head_branch: 'main', head_repository: { full_name: repository }, ...extra });

function fixture() {
  const calls = [];
  const warnings = [];
  const pending = new Map([[1, [production]]]);
  const state = { main: revision, runs: [run(1)], validated: true };
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: state.main } };
    if (endpoint === `${root}/actions/runs/10`) return { workflow_id: 20, run_number: 10 };
    if (endpoint.includes('/workflows/20/runs?')) return { workflow_runs: state.runs };
    if (endpoint.includes('/workflows/validation.yml/runs?')) return { workflow_runs: [{ conclusion: state.validated ? 'success' : 'failure' }] };
    const match = endpoint.match(/\/runs\/(\d+)\/pending_deployments$/);
    if (match) {
      if (options.body) { pending.set(Number(match[1]), []); return []; }
      return pending.get(Number(match[1])) || [];
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
  const input = {
    api, event: { workflow_run: { head_sha: revision, conclusion: 'success', head_branch: 'main', head_repository: { full_name: repository } } },
    eventName: 'workflow_run', repository, runId: '10', ref: 'refs/heads/main', sha: revision,
    reviewToken: 'fake-review-token', warn: message => warnings.push(message),
  };
  return { input, state, pending, calls, warnings };
}

test('rejects only older main production approvals and preserves executing releases', async () => {
  const f = fixture();
  f.state.runs = [run(1), run(2), run(3), run(4, { status: 'completed' }), run(11), run(5, { head_branch: 'feature' }), run(6, { head_repository: { full_name: 'fork/project' } })];
  f.pending.set(2, []); // Approval already passed; SSH release may be running.
  f.pending.set(3, [{ ...production, environment: { id: 8, name: 'preview' } }]);
  const result = await prepareProductionDeploy(f.input);
  assert.deepEqual(result, { deploy: true, revision, rejected: [1] });
  const mutations = f.calls.filter(call => call.body);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].endpoint, pendingPath(1));
  assert.deepEqual(mutations[0].body.environment_ids, [7]);
  assert.equal(mutations[0].body.state, 'rejected');
  assert.ok(f.calls.every(call => !call.endpoint.includes('/cancel')));
});

test('old validation completion cannot reject approvals for a newer main', async () => {
  const f = fixture();
  f.state.main = 'b'.repeat(40);
  assert.equal((await prepareProductionDeploy(f.input)).deploy, false);
  assert.equal(f.calls.length, 1);
});

test('a newer merge during cleanup stops rejection and skips deployment', async () => {
  const f = fixture();
  const api = f.input.api;
  f.input.api = async (endpoint, options) => {
    const result = await api(endpoint, options);
    if (endpoint === pendingPath(1)) f.state.main = 'b'.repeat(40);
    return result;
  };
  assert.equal((await prepareProductionDeploy(f.input)).deploy, false);
  assert.equal(f.calls.filter(call => call.body).length, 0);
});

test('approval winning a rejection race never triggers cancellation', async () => {
  const f = fixture();
  const api = f.input.api;
  f.input.api = async (endpoint, options) => {
    if (options?.body) { f.pending.set(1, []); throw Object.assign(new Error('Already approved'), { status: 422 }); }
    return api(endpoint, options);
  };
  assert.equal((await prepareProductionDeploy(f.input)).deploy, true);
  assert.equal(f.warnings.length, 1);
});

test('failed rejection is surfaced when the approval remains pending', async () => {
  const f = fixture();
  const api = f.input.api;
  f.input.api = (endpoint, options) => {
    if (options?.body) throw Object.assign(new Error('Rejected request'), { status: 422 });
    return api(endpoint, options);
  };
  await assert.rejects(prepareProductionDeploy(f.input), /Rejected request/);
});

test('missing token preserves the existing manual approval path', async () => {
  const f = fixture();
  f.input.reviewToken = '';
  assert.equal((await prepareProductionDeploy(f.input)).deploy, true);
  assert.equal(f.warnings.length, 1);
  assert.equal(f.calls.length, 1);
});

test('a token without reviewer eligibility fails before mutation', async () => {
  const f = fixture();
  f.pending.set(1, [{ ...production, current_user_can_approve: false }]);
  await assert.rejects(prepareProductionDeploy(f.input), /required production reviewer/);
  assert.equal(f.calls.filter(call => call.body).length, 0);
});

test('rerunning cleanup is idempotent', async () => {
  const f = fixture();
  assert.deepEqual((await prepareProductionDeploy(f.input)).rejected, [1]);
  assert.deepEqual((await prepareProductionDeploy(f.input)).rejected, []);
});

test('pagination is collected before rejections change the waiting list', async () => {
  const f = fixture();
  const api = f.input.api;
  f.input.api = async (endpoint, options) => {
    if (endpoint.includes('/workflows/20/runs?')) {
      assert.equal(f.calls.filter(call => call.body).length, 0);
      return { workflow_runs: endpoint.endsWith('page=1')
        ? [run(1), ...Array.from({ length: 99 }, (_, index) => run(index + 20))]
        : [run(2)] };
    }
    return api(endpoint, options);
  };
  f.pending.set(2, [production]);
  assert.deepEqual((await prepareProductionDeploy(f.input)).rejected, [1, 2]);
});

test('GitHub permission failures do not silently start a release', async () => {
  const f = fixture();
  const api = f.input.api;
  f.input.api = (endpoint, options) => {
    if (options?.body) throw Object.assign(new Error('Permission denied'), { status: 403 });
    return api(endpoint, options);
  };
  await assert.rejects(prepareProductionDeploy(f.input), /Permission denied/);
});

test('manual dispatch requires successful validation of current main', async () => {
  const f = fixture();
  f.input.eventName = 'workflow_dispatch';
  f.state.validated = false;
  await assert.rejects(prepareProductionDeploy(f.input), /has not passed Validation/);
  f.state.validated = true;
  assert.equal((await prepareProductionDeploy(f.input)).deploy, true);
});

test('foreign, failed, non-main and malformed events cannot mutate deployments', async () => {
  for (const update of [
    { conclusion: 'failure' }, { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/project' } }, { head_sha: 'invalid' },
  ]) {
    const f = fixture();
    Object.assign(f.input.event.workflow_run, update);
    assert.equal((await prepareProductionDeploy(f.input)).deploy, false);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  Object.assign(f.input, { eventName: 'workflow_dispatch', ref: 'refs/heads/feature' });
  assert.equal((await prepareProductionDeploy(f.input)).deploy, false);
});

test('CLI uses isolated HTTP, writes workflow outputs and keeps tokens out of logs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-queue-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = fixture();
  const eventPath = path.join(directory, 'event.json');
  const outputPath = path.join(directory, 'output');
  fs.writeFileSync(eventPath, JSON.stringify(f.input.event));
  fs.writeFileSync(outputPath, '');
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const reviewing = req.url.includes('pending_deployments');
    if (req.headers.authorization !== `Bearer ${reviewing ? 'fake-review-token' : 'fake-read-token'}`) {
      res.writeHead(401).end('{}'); return;
    }
    try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await f.input.api(req.url, { body }))); }
    catch (_) { res.writeHead(500).end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'prepare-production-deploy.cjs')], {
      env: { ...process.env, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: 'fake-read-token',
        DEPLOY_REVIEW_TOKEN: 'fake-review-token', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath,
        GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: '10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(text) : reject(new Error(text)));
  });
  assert.match(fs.readFileSync(outputPath, 'utf8'), new RegExp(`deploy=true\\nrevision=${revision}\\n`));
  assert.equal(f.calls.filter(call => call.body).length, 1);
  assert.ok(!output.includes('fake-read-token') && !output.includes('fake-review-token'));
});
