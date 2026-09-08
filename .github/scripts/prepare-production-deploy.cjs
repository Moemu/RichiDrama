'use strict';

const fs = require('node:fs');

async function prepareProductionDeploy({ api, event, eventName, repository, runId, ref, sha, reviewToken, warn }) {
  const revision = eventName === 'workflow_run' ? event.workflow_run?.head_sha : sha;
  const eligible = eventName === 'workflow_run'
    ? event.workflow_run?.conclusion === 'success'
      && event.workflow_run?.head_branch === 'main'
      && event.workflow_run?.head_repository?.full_name === repository
    : eventName === 'workflow_dispatch' && ref === 'refs/heads/main';
  if (!eligible || !/^[a-f0-9]{40}$/.test(revision || '')) return { deploy: false, rejected: [] };

  const root = `/repos/${repository}`;
  const isCurrent = async () => (await api(`${root}/git/ref/heads/main`)).object.sha === revision;
  if (!await isCurrent()) return { deploy: false, revision, rejected: [] };

  // Manual dispatch must meet the same validation gate as workflow_run.
  if (eventName === 'workflow_dispatch') {
    const validation = await api(`${root}/actions/workflows/validation.yml/runs?branch=main&event=push&head_sha=${revision}&per_page=1`);
    if (validation.workflow_runs[0]?.conclusion !== 'success') {
      throw new Error('The current main revision has not passed Validation.');
    }
  }
  if (!reviewToken) {
    warn('DEPLOY_REVIEW_TOKEN is not configured; old approval requests must still be handled manually.');
    return { deploy: true, revision, rejected: [] };
  }

  const current = await api(`${root}/actions/runs/${runId}`);
  const rejected = [];
  const waitingRuns = [];
  for (let page = 1; ; page++) {
    const result = await api(`${root}/actions/workflows/${current.workflow_id}/runs?status=waiting&per_page=100&page=${page}`);
    waitingRuns.push(...result.workflow_runs);
    if (result.workflow_runs.length < 100) break;
  }
  for (const run of waitingRuns) {
    if (run.id === Number(runId) || run.run_number >= current.run_number || run.status === 'completed') continue;
    if (run.head_branch !== 'main' || run.head_repository?.full_name !== repository) continue;
    const endpoint = `${root}/actions/runs/${run.id}/pending_deployments`;
    const pending = await api(endpoint, { review: true });
    const production = pending.find(item => item.environment.name === 'production');
    if (!production) continue;
    if (!await isCurrent()) return { deploy: false, revision, rejected };
    if (!production.current_user_can_approve) {
      throw new Error('DEPLOY_REVIEW_TOKEN must belong to a required production reviewer.');
    }
    try {
      // Reject only the pending environment approval, never cancel a run.
      // If approval wins this race, the deployment must continue undisturbed.
      await api(endpoint, {
        review: true,
        body: {
          environment_ids: [production.environment.id],
          state: 'rejected',
          comment: `Superseded by validated main ${revision} (run ${runId}).`,
        },
      });
      rejected.push(run.id);
    } catch (error) {
      if (![400, 409, 422].includes(error.status)) throw error;
      const remaining = await api(endpoint, { review: true });
      if (remaining.some(item => item.environment.id === production.environment.id)) throw error;
      warn(`Run ${run.id} left pending approval before rejection; it was not cancelled.`);
    }
  }
  return { deploy: await isCurrent(), revision, rejected };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const reviewToken = process.env.DEPLOY_REVIEW_TOKEN;
  const api = async (endpoint, options = {}) => {
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${endpoint}`, {
      method: options.body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${options.review ? reviewToken : token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Object.assign(new Error(`GitHub API ${response.status}: ${endpoint}`), { status: response.status });
    return response.json();
  };
  const result = await prepareProductionDeploy({
    api,
    event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    reviewToken,
    warn: message => console.warn(`::warning::${message}`),
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${result.deploy}\nrevision=${result.revision || ''}\n`);
  console.log(JSON.stringify(result));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareProductionDeploy };
