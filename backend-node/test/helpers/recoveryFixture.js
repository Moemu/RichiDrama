const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../../src/db/migrate');
const { setupRouter } = require('../../src/routes');
const { requireAuth } = require('../../src/middleware/auth');
const auth = require('../../src/services/authService');

async function localMailbox() {
  const messages = [];
  let reject = false;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test mailbox\r\n');
    let buffer = '', data = false, message = '', recipient = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data) {
          if (line === '.') {
            const body = message.slice(message.indexOf('\n\n') + 2);
            const decoded = /Content-Transfer-Encoding: base64/i.test(message) ? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') : body.replace(/=\n/g, '');
            messages.push({ recipient, raw: message, code: decoded.match(/\b\d{6}\b/)?.[0] });
            data = false;
            socket.write('250 accepted\r\n');
          } else message += line + '\n';
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if (/^MAIL FROM/i.test(line)) socket.write(reject ? '550 mailbox unavailable\r\n' : '250 ok\r\n');
        else if (/^RCPT TO/i.test(line)) { recipient = line; socket.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { data = true; message = ''; socket.write('354 send content\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    messages, port: server.address().port,
    set reject(value) { reject = value; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}

async function createRecoveryFixture(port = 0) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-recovery-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const mailbox = await localMailbox();
  const adminPassword = 'FixtureAdmin123';
  const env = { AUTH_JWT_SECRET: crypto.randomBytes(32).toString('hex'), INITIAL_ADMIN_USERNAME: 'admin', INITIAL_ADMIN_PASSWORD: adminPassword, MINIDRAMA_PROFILE: 'dev', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(mailbox.port), SMTP_FROM: 'test@example.test', SMTP_REQUIRE_TLS: 'false', SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASSWORD: '' };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let db, server;
  function open() {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.get('/__test/mailbox', (_req, res) => res.json(mailbox.messages.map(({ recipient, code }) => ({ recipient, code }))));
    app.use('/api/v1', setupRouter({ storage: { local_path: directory }, payment: { enabled: false } }, db, { info() {}, warn() {}, error() {} }));
    app.get('/static/protected-test', requireAuth(db), (_req, res) => res.send('protected media'));
    return app;
  }
  let app = open();
  const admin = auth.ensureBootstrapAdmin(db, { warn() {} });
  const user = auth.createUser(db, { username: 'recovery-creator', password: 'Creator123' }, admin.id);
  const other = auth.createUser(db, { username: 'recovery-other', password: 'Creator123' }, admin.id);
  async function listen() { await new Promise((resolve) => { server = app.listen(port, '127.0.0.1', resolve); }); }
  await listen();
  return {
    get db() { return db; }, get url() { return `http://127.0.0.1:${server.address().port}`; },
    admin, adminPassword, user, other, mailbox, directory,
    async restart() {
      await new Promise((resolve) => server.close(resolve)); db.close(); app = open(); await listen();
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await mailbox.close();
      db.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      const resolved = fs.realpathSync(directory);
      if (path.dirname(resolved).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase() || !path.basename(resolved).startsWith('lmd-recovery-')) throw new Error('Unexpected fixture directory');
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  };
}

module.exports = { createRecoveryFixture };

if (require.main === module) {
  createRecoveryFixture(5679).then((fixture) => {
    console.log('Isolated recovery preview ready on 127.0.0.1:5679');
    const stop = async () => { await fixture.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
