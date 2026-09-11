'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const Y = require('yjs');
const WebSocket = require('ws');
const { createFaultProxy } = require('./collaboration-fault-proxy');

const seconds = Number(process.env.COLLAB_RESILIENCE_SECONDS || 60);
const soakSeconds = Number(process.env.COLLAB_RESILIENCE_SOAK_SECONDS || 600);
const seed = Number(process.env.COLLAB_RESILIENCE_SEED || 20260910);
if (![seconds, soakSeconds].every(n => Number.isInteger(n) && n >= 6 && n <= 3600) || !Number.isInteger(seed) || !seed) throw new Error('Invalid resilience profile');
const output = path.resolve(process.env.COLLAB_RESILIENCE_OUTPUT || 'collaboration-resilience-result.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-resilience-'));
const password = crypto.randomBytes(24).toString('base64url');
const encode = bytes => Buffer.from(bytes).toString('base64');
const decode = value => Buffer.from(value, 'base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = target => `${target.kind}:${target.id}:${target.field}`;
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, p50: percentile(.5), p95: percentile(.95), max: percentile(1) };
};
let server; let backend; let proxy;
async function serverMessage(type) {
  return new Promise((resolve, reject) => {
    const current = server;
    const timer = setTimeout(() => { clean(); reject(new Error(`Backend ${type} timeout`)); }, 30000);
    const receive = value => { if (value.type === type) { clean(); resolve(value); } };
    const exited = code => { clean(); reject(new Error(`Backend exited ${code}`)); };
    const clean = () => { clearTimeout(timer); current.off('message', receive); current.off('exit', exited); };
    current.on('message', receive); current.on('exit', exited);
  });
}
async function start() {
  server = fork(path.join(__dirname, 'collaboration-load-server.js'), [], { env: { ...process.env, MINIDRAMA_PROFILE: 'dev', COLLAB_LOAD_ROOT: root, COLLAB_LOAD_PASSWORD: password }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  backend = (await serverMessage('ready')).base;
  proxy.target = new URL(backend).origin;
}
async function command(type) { const value = serverMessage(type); server.send({ type }); return value; }
async function stop(abrupt = false) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  if (abrupt) server.kill('SIGKILL'); else server.send({ type: 'stop' });
  await exited; server = null;
}
async function request(token, method, route, body, direct = false) {
  const response = await fetch((direct ? backend : proxy.url + '/api/v1') + route, {
    method, headers: { 'content-type': 'application/json', 'x-lmd-session': token || '', 'x-project-operation': crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`), { status: response.status });
  return value.data;
}

async function run(profile, tokens) {
  const models = []; const clients = []; const errors = []; const ackTimes = []; const refreshTimes = []; const checkpoints = [];
  const beforeFaults = { ...proxy.stats };
  let active = true; let paused = false; let generated = 0; let acknowledgements = 0; let expectedTransportErrors = 0; let reconnects = 0; let foreignMessages = 0;
  function record(error) {
    if (error.code === 'TRANSPORT' || error.status === 503 || /fetch failed|socket hang up|ECONNRESET/.test(error.message)) expectedTransportErrors++;
    else errors.push(error.message);
  }
  const transport = message => Object.assign(new Error(message), { code: 'TRANSPORT' });
  function textRoute(model) { return `/dramas/${model.projectId}/collaboration/text?` + new URLSearchParams(model.target); }
  async function makeModel(projectId, target) {
    const initial = await request(tokens[0], 'GET', textRoute({ projectId, target }));
    const oracle = new Y.Doc(); const durable = new Y.Doc();
    Y.applyUpdate(oracle, decode(initial.state)); Y.applyUpdate(durable, decode(initial.state));
    const model = { projectId, target, initial, oracle, durable };
    models.push(model); return model;
  }
  function send(client, type, fields = {}) {
    if (client.socket?.readyState !== WebSocket.OPEN) return Promise.reject(transport('Socket offline'));
    const request_id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.pending.delete(request_id); reject(transport('Acknowledgement timeout')); }, 15000);
      client.pending.set(request_id, { resolve, reject, timer, type });
      client.socket.send(JSON.stringify({ type, request_id, ...client.model.target, epoch: client.model.initial.epoch, ...fields }));
    });
  }
  async function flush(client) {
    if (!client.dirty || client.saving || client.socket?.readyState !== WebSocket.OPEN || paused) return;
    client.saving = true;
    const generation = client.generation; const started = performance.now();
    try {
      const message = await send(client, 'text_update', { update: encode(Y.encodeStateAsUpdate(client.doc, decode(client.vector))) });
      Y.applyUpdate(client.model.durable, decode(message.state));
      acknowledgements++; ackTimes.push(performance.now() - started);
      if (generation === client.generation) client.dirty = false;
    } catch (error) { record(error); }
    finally {
      client.saving = false;
      if (client.dirty && generation !== client.generation && active) void flush(client);
    }
  }
  async function connect(client) {
    if (!active || paused || client.connecting || client.socket?.readyState === WebSocket.OPEN) return;
    client.connecting = true; client.revision = -1;
    const socket = new WebSocket(proxy.url.replace(/^http/, 'ws') + `/api/v1/dramas/${client.model.projectId}/collaboration/socket`, { origin: proxy.url, headers: { cookie: `lmd_session=${encodeURIComponent(tokens[client.index])}` } });
    client.socket = socket;
    socket.on('error', () => {});
    socket.on('close', () => {
      for (const pending of client.pending.values()) { clearTimeout(pending.timer); pending.reject(transport('Disconnected with request pending')); }
      client.pending.clear();
      clearTimeout(client.reconnectTimer);
      if (active) client.reconnectTimer = setTimeout(() => { void connect(client); }, 1500);
    });
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'text') {
        const known = models.find(model => key(model.target) === key(message));
        if (!known || known.projectId !== client.model.projectId) { foreignMessages++; errors.push('Cross-project text broadcast'); return; }
        if (key(message) === key(client.model.target)) {
          if (message.epoch !== client.model.initial.epoch) errors.push('Unexpected epoch change');
          Y.applyUpdate(client.doc, decode(message.state)); client.vector = message.state_vector;
        }
      }
      if (message.type === 'state' && message.revision !== client.revision) {
        client.revision = message.revision;
        void send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) }).catch(record);
        const started = performance.now();
        void request(tokens[client.index], 'GET', `/dramas/${client.model.projectId}`).then(() => refreshTimes.push(performance.now() - started)).catch(record);
      }
      const pending = client.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer); client.pending.delete(message.request_id);
        if (message.type === 'error') pending.reject(new Error(`${message.code}: ${message.message}`)); else pending.resolve(message);
      }
    });
    try {
      await once(socket, 'open'); reconnects++;
      await send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) });
      void flush(client);
    } catch (error) { record(transport(error.message)); }
    finally { client.connecting = false; }
  }
  function edit(client) {
    const doc = client.doc; const text = doc.getText('content'); const vector = Y.encodeStateVector(doc);
    client.generation++;
    // All users replace overlapping characters at the start of the same paragraph.
    const index = (client.index + client.generation) % Math.max(1, Math.min(12, text.length));
    doc.transact(() => {
      text.delete(index, Math.min(2, text.length - index));
      text.insert(index, `${client.index % 10}文`);
    });
    Y.applyUpdate(client.model.oracle, Y.encodeStateAsUpdate(doc, vector));
    generated++; client.dirty = true; void flush(client);
  }
  async function verifyDurable() {
    for (const model of models) {
      const persisted = await request(tokens[0], 'GET', textRoute(model), undefined, true);
      const doc = new Y.Doc(); Y.applyUpdate(doc, decode(persisted.state));
      const vector = encode(Y.encodeStateVector(doc)); const text = doc.getText('content').toString();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(model.durable));
      assert.equal(encode(Y.encodeStateVector(doc)), vector, 'Acknowledged insertions survive before any client replay');
      assert.equal(doc.getText('content').toString(), text, 'Acknowledged deletions survive before any client replay');
      doc.destroy();
    }
  }
  async function settle() {
    const deadline = performance.now() + 45000;
    while (performance.now() < deadline) {
      for (const client of clients) if (client.socket?.readyState !== WebSocket.OPEN && !client.connecting) await connect(client);
      // Match reconnect-triggered flushing; do not introduce a periodic retry absent from the UI.
      if (clients.every(client => !client.dirty && !client.saving && client.socket?.readyState === WebSocket.OPEN)) break;
      await sleep(100);
    }
    assert.ok(clients.every(client => !client.dirty && !client.saving), 'All drafts acknowledged after network recovery');
    await Promise.all(clients.map(client => send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) })));
    for (const model of models) {
      const expected = model.oracle.getText('content').toString();
      const persisted = await request(tokens[0], 'GET', textRoute(model));
      assert.equal(persisted.text, expected, 'All generated overlapping edits converge in persistent document');
      const detail = await request(tokens[0], 'GET', `/dramas/${model.projectId}`);
      const entity = model.target.kind === 'dramas' ? detail : detail.episodes.find(episode => episode.id === model.target.id);
      assert.equal(entity[model.target.field], expected, 'Business detail agrees with CRDT storage');
      for (const client of clients.filter(item => item.model === model)) assert.equal(client.doc.getText('content').toString(), expected, 'Every client converges');
    }
    await verifyDurable();
  }
  async function crash() {
    paused = true;
    const pendingWrites = clients.filter(client => client.saving).length;
    assert.ok(pendingWrites > 0, 'Crash occurs with writes in flight');
    proxy.target = null;
    await stop(true);
    await start();
    // Check durable data before allowing clients to repair anything by replaying drafts.
    await verifyDurable();
    checkpoints.push({ type: 'abrupt-restart', pendingWrites, acknowledgedBeforeReplay: true });
    paused = false;
    for (const client of clients) { clearTimeout(client.reconnectTimer); void connect(client); }
  }
  try {
    proxy.enabled = false; proxy.duplicateEvery = 0; proxy.loseAckEvery = 0;
    const groups = [];
    for (let group = 0; group < profile.projects; group++) {
      const project = await request(tokens[0], 'POST', '/dramas', { title: `隔离韧性验收-${profile.name}-${group}`, description: '共同编辑这一段文字，核对并发删除与插入的最终结果。'.repeat(100) });
      const members = Array.from({ length: 20 }, (_, index) => index).filter(index => index % profile.projects === group);
      for (const index of members.filter(index => index !== 0)) await request(tokens[0], 'PUT', `/dramas/${project.id}/collaboration/members`, { username: `load_user_${index}`, role: 'editor' });
      const documents = [await makeModel(project.id, { kind: 'dramas', id: project.id, field: 'description' })];
      if (profile.projects > 1) {
        const detail = await request(tokens[0], 'PATCH', `/dramas/${project.id}/collaboration/episodes`, { creates: [{ episode_number: 1, title: '协作分集', script_content: '多人共同修改同一集的剧本文字。'.repeat(100) }] });
        documents.push(await makeModel(project.id, { kind: 'episodes', id: detail.episodes[0].id, field: 'script_content' }));
      }
      groups.push(documents);
    }
    for (let index = 0; index < 20; index++) {
      const documents = groups[index % profile.projects];
      const model = documents[Math.floor(index / profile.projects) % documents.length];
      const doc = new Y.Doc(); Y.applyUpdate(doc, decode(model.initial.state));
      clients.push({ index, model, doc, vector: model.initial.state_vector, generation: 0, dirty: false, saving: false, connecting: false, pending: new Map() });
    }
    if (profile.projects > 1) {
      await assert.rejects(request(tokens[1], 'GET', `/dramas/${groups[0][0].projectId}`), error => error.status === 404);
      checkpoints.push({ type: 'cross-project-permission', nonMemberReadRejected: true });
    }
    await Promise.all(clients.map(connect));
    await command('reset');
    proxy.enabled = true; proxy.duplicateEvery = profile.duplicates ? 13 : 0; proxy.loseAckEvery = profile.churn ? 37 : 0;
    const started = performance.now();
    console.log(`START ${profile.name}: 20 clients, ${models.length} documents, ${profile.seconds}s`);
    const crashTicks = new Set([Math.floor(profile.seconds / 3), Math.floor(profile.seconds * 2 / 3)]);
    for (let tick = 0; tick < profile.seconds; tick++) {
      await sleep(Math.max(0, started + tick * 1000 - performance.now()));
      for (const client of clients) edit(client);
      if (profile.churn && tick > 0 && tick % 5 === 0) proxy.disconnectSome(3);
      if (profile.crash && crashTicks.has(tick)) { await sleep(30); await crash(); }
      if (tick > 0 && tick % 60 === 0) {
        const metrics = await command('metrics');
        checkpoints.push({ type: 'sample', seconds: tick, generated, acknowledgements, dirtyClients: clients.filter(client => client.dirty).length, metrics });
        console.log(`PROGRESS ${profile.name}: ${tick}s, generated=${generated}, acknowledgements=${acknowledgements}, RSS=${metrics.peakRssMiB.toFixed(1)} MiB`);
      }
    }
    await sleep(Math.max(0, started + profile.seconds * 1000 - performance.now()));
    const metrics = await command('metrics');
    proxy.enabled = false; proxy.duplicateEvery = 0; proxy.loseAckEvery = 0;
    const recoveryStarted = performance.now(); await settle();
    const recoveryMs = performance.now() - recoveryStarted;
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const hashes = models.map(model => ({ target: model.target, hash: crypto.createHash('sha256').update(model.oracle.getText('content').toString()).digest('hex') }));
    const result = { name: profile.name, users: 20, projects: profile.projects, documents: models.length, seconds: profile.seconds, generatedEdits: generated, acknowledgedBatches: acknowledgements, expectedTransportErrors, unexpectedErrors: errors, connectionsOpened: reconnects, foreignMessages, ackMs: stats(ackTimes), refreshMs: stats(refreshTimes), recoveryMs, metrics, faults: Object.fromEntries(Object.keys(proxy.stats).map(name => [name, proxy.stats[name] - beforeFaults[name]])), checkpoints, hashes, allGeneratedEditsConverged: true, acknowledgedDataDurable: true, draftsDrained: true };
    console.log(`PASS ${profile.name}: ${generated} edits, recovery=${recoveryMs.toFixed(0)}ms, faults=${JSON.stringify(result.faults)}`);
    return result;
  } finally {
    active = false;
    for (const client of clients) {
      clearTimeout(client.reconnectTimer); client.socket?.terminate();
      for (const pending of client.pending.values()) { clearTimeout(pending.timer); pending.reject(transport('Test cleanup')); }
      client.pending.clear(); client.doc.destroy();
    }
    for (const model of models) { model.oracle.destroy(); model.durable.destroy(); }
  }
}

(async () => {
  const report = { timestamp: new Date().toISOString(), seed, host: { node: process.version, platform: process.platform, cpu: os.cpus()[0].model, ramGiB: os.totalmem() / 1073741824 }, network: { oneWayDelayMs: [20, 149], spikeProbability: .02, spikeExtraMs: 1000, orderedWebSocketMessages: true, tcpPacketLossEmulated: false }, profiles: [] };
  try {
    proxy = await createFaultProxy(seed); await start();
    const tokens = [];
    for (let i = 0; i < 20; i++) tokens.push((await request('', 'POST', '/auth/login', { username: `load_user_${i}`, password })).token);
    for (const profile of [
      { name: 'overlapping-text-jitter', projects: 1, seconds },
      { name: 'disconnect-ack-loss-replay', projects: 1, seconds, churn: true, duplicates: true },
      { name: 'multi-project-multi-field', projects: 4, seconds, churn: true, duplicates: true },
      { name: 'abrupt-restart-during-writes', projects: 1, seconds, crash: true },
      { name: 'sustained-network-faults', projects: 4, seconds: soakSeconds, churn: true, duplicates: true },
    ]) {
      report.profiles.push(await run(profile, tokens));
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
  } catch (error) { report.failure = error.stack; fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.error(error); process.exitCode = 1; }
  finally {
    if (proxy) { proxy.enabled = false; proxy.target = null; await proxy.close(); }
    await stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
