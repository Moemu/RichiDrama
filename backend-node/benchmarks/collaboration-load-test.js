'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const Y = require('yjs');

const seconds = Number(process.env.COLLAB_LOAD_SECONDS || 60);
const sizes = (process.env.COLLAB_LOAD_USERS || '10,30,50').split(',').map(Number);
if (!Number.isFinite(seconds) || seconds < 2 || seconds > 600 || sizes.some(n => !Number.isInteger(n) || n < 2 || n > 50)) throw new Error('Invalid load profile');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-collaboration-load-'));
const password = crypto.randomBytes(24).toString('base64url');
const output = path.resolve(process.env.COLLAB_LOAD_OUTPUT || 'collaboration-load-result.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const encode = value => Buffer.from(value).toString('base64');
const decode = value => Buffer.from(value, 'base64');
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
};
let child; let base;
function childMessage(type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Server ${type} timeout`)); }, 30000);
    const receive = value => { if (value.type === type) { cleanup(); resolve(value); } };
    const exited = code => { cleanup(); reject(new Error(`Server exited ${code}`)); };
    const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); };
    child.on('message', receive); child.on('exit', exited);
  });
}
async function start() {
  child = fork(path.join(__dirname, 'collaboration-load-server.js'), [], { env: { ...process.env, MINIDRAMA_PROFILE: 'dev', COLLAB_LOAD_ROOT: root, COLLAB_LOAD_PASSWORD: password }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  base = (await childMessage('ready')).base;
}
async function stop() { const exited = once(child, 'exit'); child.send({ type: 'stop' }); await exited; child = null; }
async function command(type) { const reply = childMessage(type); child.send({ type }); return reply; }
async function request(token, method, route, data) {
  const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-lmd-session': token || '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) });
  const value = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(value)}`);
  return value.data;
}

async function run(count, tokens) {
  const marker = (index, step) => `【用户${String(index).padStart(2, '0')}:${String(step).padStart(5, '0')}】`;
  const description = '这是共同编辑的压力测试文本。'.repeat(350) + '\n' + Array.from({ length: count }, (_, i) => marker(i, 0)).join('\n');
  const project = await request(tokens[0], 'POST', '/dramas', { title: `隔离协作压测${count}人`, description });
  const route = `/dramas/${project.id}`;
  for (let i = 1; i < count; i++) await request(tokens[0], 'PUT', route + '/collaboration/members', { username: `load_user_${i}`, role: 'editor' });
  const target = { kind: 'dramas', id: project.id, field: 'description' };
  const readRoute = route + '/collaboration/text?' + new URLSearchParams(target);
  const initial = await request(tokens[0], 'GET', readRoute);
  const expected = new Y.Doc(); Y.applyUpdate(expected, decode(initial.state));
  const errors = []; const acknowledgements = []; const propagation = []; const refresh = []; const lag = [];
  const observations = new Set(); let measuring = false; let receivedBytes = 0; let offered = 0; let sent = 0; let skipped = 0;
  const clients = Array.from({ length: count }, (_, index) => ({ index, doc: new Y.Doc(), vector: initial.state_vector, revision: -1, pending: new Map(), step: 0, busy: false }));
  for (const client of clients) Y.applyUpdate(client.doc, decode(initial.state));
  function fail(error) { errors.push(String(error.message || error)); }
  async function send(client, type, extra = {}) {
    const request_id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.pending.delete(request_id); reject(new Error(`${type} acknowledgement timeout`)); }, 15000);
      client.pending.set(request_id, { resolve, reject, timer });
      client.socket.send(JSON.stringify({ type, request_id, ...target, epoch: initial.epoch, ...extra }));
    });
  }
  async function connect(client) {
    client.revision = -1;
    const socket = new WebSocket(base.replace(/^http/, 'ws') + route + '/collaboration/socket', { origin: new URL(base).origin, headers: { cookie: `lmd_session=${encodeURIComponent(tokens[client.index])}` } });
    client.socket = socket;
    socket.on('error', fail);
    socket.on('message', bytes => {
      if (measuring) receivedBytes += bytes.length;
      const message = JSON.parse(bytes.toString());
      if (message.type === 'text') {
        if (message.epoch !== initial.epoch) fail(new Error('Unexpected document epoch'));
        Y.applyUpdate(client.doc, decode(message.state)); client.vector = message.state_vector;
        const content = client.doc.getText('content').toString();
        for (const observation of observations) {
          if (observation.remaining.has(client.index) && content.includes(observation.marker)) observation.remaining.delete(client.index);
          if (!observation.remaining.size) { propagation.push(performance.now() - observation.started); observations.delete(observation); }
        }
      }
      if (message.type === 'state' && client.revision !== message.revision) {
        client.revision = message.revision;
        send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) }).catch(fail);
        const started = performance.now(); const record = measuring;
        request(tokens[client.index], 'GET', route).then(() => { if (record) refresh.push(performance.now() - started); }).catch(fail);
      }
      const pending = client.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer); client.pending.delete(message.request_id);
        if (message.type === 'error') pending.reject(new Error(`${message.code}: ${message.message}`)); else pending.resolve(message);
      }
    });
    await once(socket, 'open');
    await send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) });
  }
  function edit(client) {
    const text = client.doc.getText('content');
    const previous = marker(client.index, client.step); const position = text.toString().indexOf(previous);
    assert.notEqual(position, -1, 'Own marker must exist');
    const vector = Y.encodeStateVector(client.doc); client.step++;
    client.doc.transact(() => { text.delete(position, previous.length); text.insert(position, marker(client.index, client.step)); });
    Y.applyUpdate(expected, Y.encodeStateAsUpdate(client.doc, vector));
  }
  async function write(client, record) {
    const started = performance.now();
    if (record) {
      sent++;
      observations.add({ marker: marker(client.index, client.step), started, remaining: new Set(clients.filter(c => c !== client).map(c => c.index)) });
    }
    await send(client, 'text_update', { update: encode(Y.encodeStateAsUpdate(client.doc, decode(client.vector))) });
    if (record) acknowledgements.push(performance.now() - started);
  }
  async function disconnect() {
    await Promise.all(clients.map(client => new Promise(resolve => { client.socket.once('close', resolve); client.socket.close(); })));
  }
  async function verify() {
    await Promise.all(clients.map(client => send(client, 'text_read', { state_vector: encode(Y.encodeStateVector(client.doc)) })));
    const content = expected.getText('content').toString();
    assert.equal((await request(tokens[0], 'GET', route)).description, content, 'Persisted project text');
    const persisted = await request(tokens[0], 'GET', readRoute);
    assert.equal(persisted.text, content, 'Persisted collaboration text');
    for (const client of clients) {
      assert.equal(client.doc.getText('content').toString(), content, `Client ${client.index} convergence`);
      assert.equal(content.split(marker(client.index, client.step)).length, 2, 'Exactly one latest marker');
    }
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  try {
    await Promise.all(clients.map(connect)); await sleep(1000);
    await command('reset');
    const generatorDelay = monitorEventLoopDelay({ resolution: 10 }); generatorDelay.enable();
    const cpu = process.cpuUsage(); const started = performance.now(); measuring = true;
    console.log(`START ${count} users, ${seconds}s, 1 edit/user/s`);
    await Promise.all(clients.map(async client => {
      for (let tick = 0; tick < seconds; tick++) {
        const due = started + tick * 1000 + client.index * 1000 / count;
        await sleep(Math.max(0, due - performance.now())); lag.push(Math.max(0, performance.now() - due)); offered++;
        if (client.busy) { skipped++; continue; }
        client.busy = true;
        try { edit(client); } catch (error) { fail(error); client.busy = false; continue; }
        void write(client, true).catch(fail).finally(() => { client.busy = false; });
      }
    }));
    await sleep(Math.max(0, started + seconds * 1000 - performance.now()));
    measuring = false;
    const durationSeconds = (performance.now() - started) / 1000;
    const server = await command('metrics');
    const used = process.cpuUsage(cpu); generatorDelay.disable();
    const generator = { cpuOneCorePercent: (used.user + used.system) / (durationSeconds * 10000), eventLoopP99Ms: generatorDelay.percentile(99) / 1e6, schedulerLagMs: summarize(lag) };
    const deadline = performance.now() + 16000;
    while (clients.some(c => c.busy || c.pending.size) && performance.now() < deadline) await sleep(50);
    const hash = await verify();
    const unobservedUpdates = observations.size;
    observations.clear();
    await disconnect();
    for (const client of clients) edit(client);
    await sleep(1500);
    const reconnectStart = performance.now();
    await Promise.all(clients.map(connect)); await Promise.all(clients.map(client => write(client, false)));
    const offlineHash = await verify(); const reconnectMs = performance.now() - reconnectStart;
    await disconnect(); await stop();
    const restartStart = performance.now(); await start(); await Promise.all(clients.map(connect));
    assert.equal(await verify(), offlineHash); const restartMs = performance.now() - restartStart;
    const result = { users: count, requestedSeconds: seconds, durationSeconds, offered, sent, skipped, acknowledged: acknowledgements.length, updatesPerSecond: acknowledgements.length / durationSeconds, ackMs: summarize(acknowledgements), allPeersMs: summarize(propagation), unobservedUpdates, refreshMs: summarize(refresh), receivedMiB: receivedBytes / 1048576, errors, server, generator, consistency: { allClientsAndDatabase: true, hash, offlineReplay: true, restart: true, reconnectMs, restartMs } };
    result.correctnessPassed = !errors.length && acknowledgements.length === sent && !unobservedUpdates;
    result.interactiveTargetMet = result.correctnessPassed && !skipped && result.ackMs.p95 < 500 && result.allPeersMs.p95 < 1000;
    console.log(JSON.stringify(result));
    return result;
  } finally {
    for (const client of clients) { client.socket?.terminate(); for (const pending of client.pending.values()) clearTimeout(pending.timer); client.doc.destroy(); }
    expected.destroy();
  }
}

(async () => {
  const report = { timestamp: new Date().toISOString(), host: { platform: process.platform, node: process.version, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramGiB: os.totalmem() / 1073741824 }, profiles: [] };
  try {
    await start();
    const tokens = [];
    for (let i = 0; i < Math.max(...sizes); i++) tokens.push((await request('', 'POST', '/auth/login', { username: `load_user_${i}`, password })).token);
    for (const count of sizes) {
      report.profiles.push(await run(count, tokens));
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
  } catch (error) { report.failure = error.stack; fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); process.exitCode = 1; console.error(error); }
  finally {
    if (child) await stop();
    // root is created by mkdtemp above and is never accepted from external input.
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
