'use strict';

const http = require('node:http');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');

async function createFaultProxy(seed) {
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const proxy = { target: null, enabled: false, duplicateEvery: 0, loseAckEvery: 0, links: new Set(), stats: { delayedMessages: 0, spikes: 0, duplicateUpdates: 0, lostAcknowledgements: 0, forcedDisconnects: 0, upstreamFailures: 0 } };
  const latency = () => {
    if (!proxy.enabled) return 0;
    const spike = random() < .02;
    if (spike) proxy.stats.spikes++;
    return 20 + Math.floor(random() * 130) + (spike ? 1000 : 0);
  };
  const server = http.createServer(async (req, res) => {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    setTimeout(() => {
      if (!proxy.target) { res.writeHead(503); res.end('{"error":"injected outage"}'); return; }
      const target = new URL(proxy.target);
      const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => setTimeout(() => { if (!res.destroyed) { res.writeHead(response.statusCode, response.headers); res.end(Buffer.concat(chunks)); } }, latency()));
      });
      upstream.on('error', () => { proxy.stats.upstreamFailures++; if (!res.destroyed) { res.writeHead(503); res.end('{"error":"injected outage"}'); } });
      upstream.end(Buffer.concat(body));
    }, latency());
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!proxy.target) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, client => {
      const upstream = new WebSocket(proxy.target.replace(/^http/, 'ws') + req.url, { origin: proxy.target, headers: { cookie: req.headers.cookie || '' } });
      const link = { client, upstream, timers: new Set(), closed: false, requests: new Set() };
      proxy.links.add(link);
      const close = () => {
        if (link.closed) return;
        link.closed = true;
        for (const timer of link.timers) clearTimeout(timer);
        client.terminate(); upstream.terminate(); proxy.links.delete(link);
      };
      link.close = close;
      const forward = destination => {
        let lastDue = 0;
        return bytes => {
          const due = Math.max(lastDue, performance.now() + latency()); lastDue = due;
          proxy.stats.delayedMessages++;
          const timer = setTimeout(() => {
            link.timers.delete(timer);
            if (destination.readyState === WebSocket.OPEN) destination.send(bytes.toString());
          }, Math.max(0, due - performance.now()));
          link.timers.add(timer);
        };
      };
      const toServer = forward(upstream); const toClient = forward(client);
      const queued = [];
      client.on('message', bytes => {
        const message = JSON.parse(bytes.toString());
        if (message.type === 'text_update') link.requests.add(message.request_id);
        if (upstream.readyState !== WebSocket.OPEN) queued.push(bytes); else toServer(bytes);
        if (message.type === 'text_update' && proxy.duplicateEvery && ++proxy.updateCount % proxy.duplicateEvery === 0) {
          proxy.stats.duplicateUpdates++;
          if (upstream.readyState !== WebSocket.OPEN) queued.push(bytes); else toServer(bytes);
        }
      });
      upstream.on('open', () => { for (const bytes of queued) toServer(bytes); queued.length = 0; });
      upstream.on('message', bytes => {
        const message = JSON.parse(bytes.toString());
        if (message.type === 'text' && link.requests.delete(message.request_id) && proxy.loseAckEvery && ++proxy.ackCount % proxy.loseAckEvery === 0) {
          proxy.stats.lostAcknowledgements++; close(); return;
        }
        toClient(bytes);
      });
      upstream.on('error', () => { proxy.stats.upstreamFailures++; close(); });
      client.on('error', close); upstream.on('close', close); client.on('close', close);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  proxy.url = `http://127.0.0.1:${server.address().port}`;
  proxy.updateCount = 0; proxy.ackCount = 0;
  proxy.disconnectSome = count => {
    const links = [...proxy.links];
    for (let i = 0; i < count && links.length; i++) { const index = Math.floor(random() * links.length); links.splice(index, 1)[0].close(); proxy.stats.forcedDisconnects++; }
  };
  proxy.close = async () => {
    for (const link of [...proxy.links]) link.close();
    wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  };
  return proxy;
}

module.exports = { createFaultProxy };
