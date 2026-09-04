const test = require('node:test');
const assert = require('node:assert/strict');
const { ownershipGuard } = require('../src/middleware/ownership');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
}

function request(auth, ownerUserId, body = {}) {
  return {
    auth,
    path: '/omni-video-jobs',
    query: {},
    body,
    db: { ownerUserId },
  };
}

function database(ownerUserId) {
  return { prepare: () => ({ get: () => ownerUserId == null ? undefined : { owner_user_id: ownerUserId } }) };
}

test('ownership guard allows a user to generate within their own project', () => {
  let nextCalled = false;
  ownershipGuard(database(42))(request({ id: 42, role: 'user' }, 42, { drama_id: 7 }), responseRecorder(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('ownership guard rejects cross-user generation for both user and admin accounts', () => {
  for (const auth of [{ id: 42, role: 'user' }, { id: 1, role: 'admin' }]) {
    let nextCalled = false;
    const res = responseRecorder();
    ownershipGuard(database(99))(request(auth, 99, { drama_id: 7 }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 404);
  }
});

test('ownership guard resolves a project asset through its project owner before a stale direct owner', () => {
  let queriedSql = '';
  const db = {
    prepare(sql) {
      queriedSql = sql;
      return { get: () => ({ owner_user_id: 42 }) };
    },
  };
  const req = request({ id: 42, role: 'user' }, 42);
  req.path = '/assets/123';
  let nextCalled = false;

  ownershipGuard(db)(req, responseRecorder(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.match(queriedSql, /COALESCE\(d\.owner_user_id, a\.owner_user_id\)/);
});

test('ownership guard protects video frame extraction routes', () => {
  for (const routePath of ['/video-generations/907/extract-frame', '/omni-video-jobs/81/extract-frame']) {
    const allowed = request({ id: 42, role: 'user' }, 42);
    allowed.path = routePath;
    let allowedNext = false;
    ownershipGuard(database(42))(allowed, responseRecorder(), () => { allowedNext = true; });
    assert.equal(allowedNext, true);

    const denied = request({ id: 7, role: 'user' }, 42);
    denied.path = routePath;
    const res = responseRecorder();
    let deniedNext = false;
    ownershipGuard(database(42))(denied, res, () => { deniedNext = true; });
    assert.equal(deniedNext, false);
    assert.equal(res.statusCode, 404);
  }
});
