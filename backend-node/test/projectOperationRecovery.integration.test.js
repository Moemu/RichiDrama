const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const Database = require('better-sqlite3');

test('HTTP operation records survive process termination without replaying uncertain work', async t => {
  const recoveryService = require('../src/services/projectOperationRecovery');
  const historical = { status: 409, body: { success: false, error: { code: 'OPERATION_PENDING' } } };
  assert.equal(recoveryService.recover(historical), historical, 'historical receipts have no recovery opt-in');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-operation-recovery-'));
  const filename = path.join(root, 'test.db');
  const db = new Database(filename);
  db.exec(`CREATE TABLE project_collaboration (drama_id INTEGER PRIMARY KEY,revision INTEGER);
    INSERT INTO project_collaboration VALUES (1,1);
    CREATE TABLE project_operations (drama_id INTEGER,operation_id TEXT,actor_id INTEGER,request_hash TEXT,response_json TEXT,created_at TEXT,UNIQUE(drama_id,operation_id));
    CREATE TABLE writes (id INTEGER PRIMARY KEY, name TEXT);`);
  db.close();
  const moduleFile = require.resolve('../src/middleware/projectOperations');
  const children = new Set();
  t.after(async () => {
    for (const child of children) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function start(mode) {
    const script = `
      const db = new (require('better-sqlite3'))(${JSON.stringify(filename)});
      const app = require('express')(); app.use(require('express').json());
      app.use((req,res,next) => { req.auth={id:1}; req.projectAccess={drama_id:1,collaboration_enabled:true}; next(); });
      app.use('/api/v1',require(${JSON.stringify(moduleFile)})(db));
      app.post(['/api/v1/storyboards','/api/v1/async-command'],(req,res) => {
        db.prepare('INSERT INTO writes (name) VALUES (?)').run(req.body.name);
        if (${JSON.stringify(mode)} === 'crash') process.exit(23);
        if (${JSON.stringify(mode)} === 'stream') return res.end('done');
        res.status(201).json({success:true,data:{id:db.prepare('SELECT max(id) id FROM writes').get().id}});
      });
      const server=app.listen(0,'127.0.0.1',()=>process.send(server.address().port));
    `;
    const child = spawn(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    children.add(child);
    child.once('exit', () => children.delete(child));
    const [port] = await once(child, 'message');
    return { child, base: `http://127.0.0.1:${port}/api/v1` };
  }
  const request = (server, route, id) => fetch(server.base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-project-operation': id }, body: JSON.stringify({ name: id }) });
  const count = () => { const connection = new Database(filename); const count = connection.prepare('SELECT count(*) n FROM writes').get().n; connection.close(); return count; };
  const interruptedAtomic = await start('crash');
  const firstExit = once(interruptedAtomic.child, 'exit');
  await assert.rejects(request(interruptedAtomic, '/storyboards', 'atomic-crash'));
  await firstExit;
  assert.equal(count(), 0, 'business writes roll back with the pending receipt');
  const running = await start('normal');
  const first = await (await request(running, '/storyboards', 'atomic-crash')).json();
  assert.equal(first.success, true);
  assert.equal(count(), 1);
  const secondServer = await start('normal');
  assert.deepEqual(await (await request(secondServer, '/storyboards', 'atomic-crash')).json(), first);
  assert.equal(count(), 1, 'a saved receipt replays without a second command');

  const uncertain = await start('crash');
  const asyncExit = once(uncertain.child, 'exit');
  await assert.rejects(request(uncertain, '/async-command', 'async-crash'));
  await asyncExit;
  assert.equal(count(), 2);
  assert.equal((await (await request(running, '/async-command', 'async-crash')).json()).error.code, 'OPERATION_PENDING');
  const connection = new Database(filename);
  const receipt = JSON.parse(connection.prepare("SELECT response_json FROM project_operations WHERE operation_id='async-crash'").get().response_json);
  receipt.recovery.confirm_before = new Date(Date.now() - 1).toISOString();
  connection.prepare("UPDATE project_operations SET response_json=? WHERE operation_id='async-crash'").run(JSON.stringify(receipt));
  connection.close();
  const recovered = await request(running, '/async-command', 'async-crash');
  assert.equal(recovered.status, 409);
  const recovery = await recovered.json();
  assert.equal(recovery.error.code, 'OPERATION_UNCONFIRMED');
  assert.equal(recovery.error.details.results_url, '/api/v1/dramas/1/collaboration/results');
  assert.deepEqual(await (await request(running, '/async-command', 'async-crash')).json(), recovery);
  assert.equal(count(), 2, 'an uncertain asynchronous command must never be rerun');

  const streaming = await start('stream');
  assert.equal(await (await request(streaming, '/async-command', 'stream')).text(), 'done');
  assert.equal((await (await request(streaming, '/async-command', 'stream')).json()).error.code, 'OPERATION_UNCONFIRMED');
  assert.equal(count(), 3);
});
