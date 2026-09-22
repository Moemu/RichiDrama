'use strict';

const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const auth = require('./authService');
const access = require('./projectAccessService');
const collaboration = require('./projectCollaborationService');

function attach(server, db, log) {
  let closing = false;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
  const send = (socket, value) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const authorize = socket => {
    const user = auth.authenticate(db, socket.credential);
    if (user.must_change_password) throw new Error('请先修改临时密码');
    const permission = access.requireAccess(db, socket.dramaId, user.id);
    if (!permission.collaboration_enabled) throw new Error('项目协作已关闭');
    return { user, permission };
  };
  const notify = dramaId => {
    if (closing || db.open === false) return;
    const participants = [];
    const authorized = [];
    for (const socket of sockets.clients) {
      if (socket.dramaId !== dramaId || socket.readyState !== WebSocket.OPEN) continue;
      try {
        const { user, permission } = authorize(socket);
        participants.push({ id: user.id, name: user.display_name || user.username, editing: socket.editing || null });
        authorized.push({ socket, permission });
      } catch (_) {
        if (!socket.accessRejected) log?.warn?.('project collaboration access revoked', { connection_id: socket.connectionId, drama_id: dramaId, user_id: socket.userId, close_code: 4403 });
        socket.accessRejected = true;
        socket.close(4403, '项目访问权限已失效');
      }
    }
    const revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(dramaId)?.revision || 0;
    for (const { socket, permission } of authorized) {
      const state = { type: 'state', revision, participants, permissions: permission };
      const serialized = JSON.stringify(state);
      if (serialized === socket.lastState) continue;
      send(socket, state);
      socket.lastState = serialized;
      socket.lastRevision = revision;
    }
  };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const match = /^\/api\/v1\/dramas\/(\d+)\/collaboration\/socket$/.exec(url.pathname);
    if (!match) return;
    try {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) throw new Error('来源无效');
      const rawCookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('lmd_session='));
      const credential = rawCookie ? decodeURIComponent(rawCookie.slice('lmd_session='.length)) : '';
      const user = auth.authenticate(db, credential);
      const permission = access.requireAccess(db, match[1], user.id);
      if (!permission.collaboration_enabled || user.must_change_password) throw new Error('协作不可用');
      sockets.handleUpgrade(req, socket, head, ws => {
        ws.credential = credential;
        ws.dramaId = Number(match[1]);
        ws.userId = user.id;
        ws.connectionId = randomUUID();
        sockets.emit('connection', ws);
      });
    } catch (_) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  sockets.on('connection', socket => {
    log?.info?.('project collaboration socket connected', { connection_id: socket.connectionId, drama_id: socket.dramaId, user_id: socket.userId });
    notify(socket.dramaId);
    socket.on('message', data => {
      let requestId;
      let input;
      try {
        const { user } = authorize(socket);
        input = JSON.parse(data.toString());
        requestId = input.request_id;
        if (input.type === 'presence') {
          socket.editing = typeof input.editing === 'string' ? input.editing.slice(0, 120) : null;
          notify(socket.dramaId);
        } else if (input.type === 'text_read' || input.type === 'text_update') {
          const beforeRevision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(socket.dramaId)?.revision;
          const result = input.type === 'text_read'
            ? collaboration.readText(db, socket.dramaId, user.id, input)
            : collaboration.updateText(db, socket.dramaId, user.id, input);
          if (input.type === 'text_update') {
            result.before_revision = beforeRevision;
            result.revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(socket.dramaId)?.revision;
          }
          send(socket, { type: 'text', request_id: requestId, ...result });
          if (input.type === 'text_update') {
            for (const peer of sockets.clients) {
              if (peer === socket || peer.dramaId !== socket.dramaId) continue;
              try { authorize(peer); send(peer, { type: 'text', ...result }); }
              catch (_) { peer.close(4403, '项目访问权限已失效'); }
            }
          }
        } else throw new Error('未知协作操作');
      } catch (error) {
        if (input?.type === 'text_read' || input?.type === 'text_update') log?.warn?.('project collaboration text rejected', {
          transport: 'socket', connection_id: socket.connectionId, request_id: String(requestId || '').slice(0, 128),
          drama_id: socket.dramaId, user_id: socket.userId, project_revision: socket.lastRevision ?? null, operation: input.type,
          entity_kind: String(input.kind || '').slice(0, 40), entity_id: Number(input.id) || null,
          field: String(input.field || '').slice(0, 40),
          error_code: error.code || 'COLLABORATION_ERROR', reason: error.reason || null,
        });
        send(socket, { type: 'error', request_id: requestId, code: error.code, message: error.message });
      }
    });
    socket.on('close', code => {
      if (!closing) {
        const details = { connection_id: socket.connectionId, drama_id: socket.dramaId, user_id: socket.userId, close_code: code, project_revision: socket.lastRevision ?? null };
        if (code === 1000 || code === 1001 || code === 4403) log?.info?.('project collaboration socket closed', details);
        else log?.warn?.('project collaboration socket closed', details);
      }
      notify(socket.dramaId);
    });
    socket.on('error', () => socket.close());
  });
  const timer = setInterval(() => {
    for (const dramaId of new Set([...sockets.clients].map(socket => socket.dramaId))) notify(dramaId);
  }, 750);
  timer.unref();
  server.on('close', () => { closing = true; clearInterval(timer); for (const socket of sockets.clients) socket.terminate(); sockets.close(); });
  return sockets;
}

module.exports = { attach };
