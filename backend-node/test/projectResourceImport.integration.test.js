const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');

test('resource imports create durable independent production rows through HTTP', async t => {
  const f = await modelCatalogFixture();
  t.after(() => f.close());
  const login = await f.request('POST', '/auth/login', { username: 'catalog-admin', password: 'fixture-password' });
  const cookie = login.cookie;
  const request = (method, route, body) => f.request(method, route, body, cookie);
  const created = await request('POST', '/dramas', { title: '导入验收' });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const route = `/dramas/${id}/resources/import`;
  const root = path.join(f.root, 'storage');
  fs.mkdirSync(root, { recursive: true });
  const bytes = Buffer.from('durable image fixture');
  fs.writeFileSync(path.join(root, 'source.png'), bytes);
  fs.writeFileSync(path.join(root, 'four.png'), bytes);
  const character = Number(f.db.prepare('INSERT INTO character_libraries(name,description,image_url,four_view_image_url) VALUES (?,?,?,?)').run('测试角色', '原始描述', '/static/source.png', '/static/four.png').lastInsertRowid);
  const scene = Number(f.db.prepare('INSERT INTO scene_libraries(location,time,description,prompt,image_url) VALUES (?,?,?,?,?)').run('测试场景', '夜晚', '场景描述', '场景提示', '/static/source.png').lastInsertRowid);
  const prop = Number(f.db.prepare('INSERT INTO prop_libraries(name,description,prompt) VALUES (?,?,?)').run('测试道具', '道具描述', '道具提示').lastInsertRowid);
  const legacy = Number(f.db.prepare('INSERT INTO character_libraries(name,drama_id) VALUES (?,?)').run('历史库角色', id).lastInsertRowid);
  const before = f.db.prepare('SELECT * FROM character_libraries WHERE id=?').get(character);
  const auth = require('../src/services/authService');
  for (const role of ['editor', 'viewer', 'stranger']) {
    auth.createUser(f.db, { username: `import_${role}`, password: 'fixture-password' });
    if (role !== 'stranger') assert.equal((await request('PUT', `/dramas/${id}/collaboration/members`, { username: `import_${role}`, role })).status, 200);
    const actor = await f.request('POST', '/auth/login', { username: `import_${role}`, password: 'fixture-password' });
    const result = await f.request('POST', route, { type: 'invalid', library_id: character }, actor.cookie);
    assert.equal(result.status, role === 'editor' ? 400 : role === 'viewer' ? 403 : 404);
  }
  for (const [type, library_id] of [['character', character], ['scene', scene], ['prop', prop]]) {
    const result = await request('POST', route, { type, library_id });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.data.resource_type, type);
    assert.equal((await request('POST', route, { type, library_id })).status, 409);
  }
  assert.equal((await request('POST', route, { type: 'character', library_id: legacy })).status, 404);
  assert.equal((await request('POST', route, { type: '__proto__', library_id: 1 })).status, 400);
  let detail = (await request('GET', `/dramas/${id}`)).body.data;
  const imported = detail.characters[0];
  assert.equal(imported.description, '原始描述');
  assert.notEqual(imported.local_path, 'source.png');
  assert.deepEqual(fs.readFileSync(path.join(root, imported.local_path)), bytes);
  assert.deepEqual(fs.readFileSync(path.join(root, imported.four_view_image_url.replace('/static/', ''))), bytes);
  assert.equal(detail.scenes[0].description, '场景描述');
  assert.equal(detail.props[0].description, '道具描述');
  assert.deepEqual(f.db.prepare('SELECT * FROM character_libraries WHERE id=?').get(character), before);
  const revision = f.db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(id).revision;
  for (let i = 0; i < 2; i++) assert.equal((await request('GET', `/assets?drama_id=${id}`)).status, 200);
  assert.equal(f.db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(id).revision, revision, 'unchanged media reads must not invalidate collaboration revisions');
  const edited = await request('PUT', `/characters/${imported.id}`, { description: '项目内修改' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  fs.unlinkSync(path.join(root, 'source.png'));
  fs.unlinkSync(path.join(root, 'four.png'));
  const missing = Number(f.db.prepare('INSERT INTO prop_libraries(name,image_url) VALUES (?,?)').run('缺失图片', '/static/missing.png').lastInsertRowid);
  assert.equal((await request('POST', route, { type: 'prop', library_id: missing })).status, 409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM props WHERE drama_id=?').get(id).n, 1);
  await f.restart();
  detail = (await request('GET', `/dramas/${id}`)).body.data;
  assert.equal(detail.characters[0].description, '项目内修改');
  assert.deepEqual(fs.readFileSync(path.join(root, detail.characters[0].local_path)), bytes);
  assert.deepEqual(f.db.prepare('SELECT * FROM character_libraries WHERE id=?').get(character), before);
  assert.equal(f.db.prepare('SELECT name FROM character_libraries WHERE id=?').get(legacy).name, '历史库角色');
});
