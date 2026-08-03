// Persistent background daemon. Spawned detached by the Electron main process; keeps
// running (and keeps every Claude PTY alive) after the window closes.
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from './sessionManager.js';
import { DAEMON_VERSION, DAEMON_PORT, type ClientMessage, type ServerMessage } from './protocol.js';

const CONFIG_DIR = path.join(os.homedir(), '.claude-session-manager');
const LOCK_PATH = path.join(CONFIG_DIR, 'daemon.json');

fs.mkdirSync(CONFIG_DIR, { recursive: true });

const token = randomBytes(24).toString('hex');
const manager = new SessionManager();

const httpServer = createServer((req, res) => {
  // Lightweight health probe used by the app before deciding to attach.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: DAEMON_VERSION, pid: process.pid }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('token') !== token) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

// Broadcast helpers -----------------------------------------------------------
const clients = new Set<WebSocket>();
// Track which sessions each socket is attached to, so we only stream what it wants.
const attachments = new WeakMap<WebSocket, Set<string>>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage) {
  for (const ws of clients) send(ws, msg);
}

manager.onOutput((id, data) => {
  for (const ws of clients) {
    if (attachments.get(ws)?.has(id)) send(ws, { type: 'data', id, data });
  }
});

manager.onExit((id, code) => {
  broadcast({ type: 'exit', id, code });
});

manager.onAttention((id, attention) => {
  broadcast({ type: 'activity', id, attention });
});

// Connection handling ---------------------------------------------------------
wss.on('connection', (ws) => {
  clients.add(ws);
  attachments.set(ws, new Set());
  send(ws, { type: 'hello', version: DAEMON_VERSION });
  send(ws, { type: 'sessions', sessions: manager.list() });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });

  ws.on('close', () => {
    // Release focus on everything this client was viewing so background attention
    // tracking resumes for those sessions.
    for (const id of attachments.get(ws) ?? []) manager.unfocus(id);
    clients.delete(ws);
    attachments.delete(ws);
  });
});

function handle(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'list':
      send(ws, { type: 'sessions', sessions: manager.list() });
      break;

    case 'create': {
      try {
        const info = manager.create(msg);
        send(ws, { type: 'created', session: info });
        broadcast({ type: 'session-added', session: info });
      } catch (err) {
        send(ws, { type: 'error', message: `Failed to start session: ${(err as Error).message}` });
      }
      break;
    }

    case 'attach': {
      const set = attachments.get(ws);
      if (set && !set.has(msg.id)) {
        set.add(msg.id);
        manager.focus(msg.id); // viewing it clears/blocks attention
      }
      manager.resize(msg.id, msg.cols, msg.rows);
      send(ws, { type: 'history', id: msg.id, data: manager.history(msg.id) });
      break;
    }

    case 'detach': {
      const set = attachments.get(ws);
      if (set && set.delete(msg.id)) manager.unfocus(msg.id);
      break;
    }

    case 'input':
      manager.write(msg.id, msg.data);
      break;

    case 'resize':
      manager.resize(msg.id, msg.cols, msg.rows);
      break;

    case 'rename':
      manager.rename(msg.id, msg.name);
      broadcast({ type: 'renamed', id: msg.id, name: msg.name });
      break;

    case 'kill':
      manager.kill(msg.id);
      broadcast({ type: 'session-removed', id: msg.id });
      break;

    case 'shutdown': {
      // Stop every session, tell all clients, then exit the daemon entirely.
      for (const s of manager.list()) {
        manager.kill(s.id);
        broadcast({ type: 'session-removed', id: s.id });
      }
      console.log('[daemon] shutdown requested; exiting.');
      setTimeout(() => process.exit(0), 120);
      break;
    }
  }
}

// Startup ---------------------------------------------------------------------
// Binding the fixed port IS the single-instance guard: if another daemon already holds
// it we get EADDRINUSE and exit, so duplicates can't accumulate regardless of lock state.
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[daemon] another instance already owns the port; exiting.');
    process.exit(0);
  }
  console.error('[daemon] fatal:', err);
  process.exit(1);
});

function writeLock() {
  fs.writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, port: DAEMON_PORT, token, version: DAEMON_VERSION }, null, 2)
  );
}

httpServer.listen(DAEMON_PORT, '127.0.0.1', () => {
  writeLock();
  console.log(`[daemon] listening on 127.0.0.1:${DAEMON_PORT} (pid ${process.pid})`);
});

// Self-heal: if the lock file is ever deleted while we're alive, the app would see a
// healthy port but have no token to connect. Rewrite it so the app can always recover.
setInterval(() => {
  try {
    if (!fs.existsSync(LOCK_PATH)) writeLock();
  } catch {
    /* ignore */
  }
}, 5000).unref();

function cleanup() {
  try {
    const info = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (info.pid === process.pid) fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    /* ignore */
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
