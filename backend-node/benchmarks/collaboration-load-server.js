'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const Database = require('better-sqlite3');
const express = require('express');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const { setupRouter } = require('../src/routes');
const { attach } = require('../src/services/projectCollaborationSocket');

if (!process.send || !process.env.COLLAB_LOAD_ROOT) throw new Error('Start with collaboration-load-test.js');
const root = process.env.COLLAB_LOAD_ROOT;
process.chdir(root);
const cfg = { storage: { type: 'local', local_path: path.join(root, 'storage') }, payments: { enabled: false }, image_proxy: { use_for_video: false }, vendor_lock: { enabled: false } };
fs.mkdirSync(cfg.storage.local_path, { recursive: true });
fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
fs.writeFileSync(path.join(root, 'configs/config.yaml'), JSON.stringify(cfg));
const db = new Database(path.join(root, 'load.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
runMigrationsAndEnsure(db);
if (!db.prepare('SELECT id FROM users WHERE username=?').get('load_user_0')) {
  for (let i = 0; i < 50; i++) auth.createUser(db, { username: `load_user_${i}`, password: process.env.COLLAB_LOAD_PASSWORD, display_name: `压测用户${i}` });
}
let sqliteErrors = 0;
const log = Object.fromEntries(['info', 'warn', 'error', 'debug', 'infow', 'warnw', 'errorw'].map(key => [key, (...args) => {
  if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/.test(args.map(String).join(' '))) sqliteErrors++;
}]));
const app = express();
app.use(express.json({ limit: '4mb' }));
// Only the measured business routes are reachable. No generation or worker starts.
app.use((req, res, next) => {
  const allowed = (req.method === 'POST' && ['/api/v1/auth/login', '/api/v1/dramas'].includes(req.path))
    || (req.method === 'PUT' && /^\/api\/v1\/dramas\/\d+\/collaboration\/members$/.test(req.path))
    || (req.method === 'PATCH' && /^\/api\/v1\/dramas\/\d+\/collaboration\/episodes$/.test(req.path))
    || (req.method === 'GET' && /^\/api\/v1\/dramas\/\d+(\/collaboration\/text)?$/.test(req.path));
  return allowed ? next() : res.sendStatus(403);
});
app.use('/api/v1', setupRouter(cfg, db, log));
const server = app.listen(0, '127.0.0.1', () => process.send({ type: 'ready', base: `http://127.0.0.1:${server.address().port}/api/v1` }));
const sockets = attach(server, db);
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let cpu = process.cpuUsage(); let started = performance.now(); let peakRss = 0; let peakHeap = 0;
const sample = setInterval(() => {
  const memory = process.memoryUsage();
  peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed);
}, 100);
process.on('message', message => {
  if (message.type === 'reset') {
    delay.reset(); cpu = process.cpuUsage(); started = performance.now(); peakRss = 0; peakHeap = 0; sqliteErrors = 0;
    process.send({ type: 'reset' });
  }
  if (message.type === 'metrics') {
    const used = process.cpuUsage(cpu);
    const memory = process.memoryUsage();
    process.send({ type: 'metrics', cpuOneCorePercent: (used.user + used.system) / ((performance.now() - started) * 10), peakRssMiB: peakRss / 1048576, peakHeapMiB: peakHeap / 1048576, currentRssMiB: memory.rss / 1048576, currentHeapMiB: memory.heapUsed / 1048576, openSockets: sockets.clients.size, eventLoopP95Ms: delay.percentile(95) / 1e6, eventLoopP99Ms: delay.percentile(99) / 1e6, eventLoopMaxMs: delay.max / 1e6, sqliteErrors });
  }
  if (message.type === 'stop') {
    clearInterval(sample); delay.disable();
    for (const socket of sockets.clients) socket.terminate();
    server.close(() => { db.close(); process.exit(0); });
  }
});
process.on('disconnect', () => process.exit(1));
