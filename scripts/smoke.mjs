// End-to-end smoke test: talks to the running daemon exactly like the app does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const lock = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.claude-session-manager', 'daemon.json'), 'utf8')
);
const ws = new WebSocket(`ws://127.0.0.1:${lock.port}/?token=${lock.token}`);
const cwd = process.cwd();
let sessionId = null;
let gotOutput = false;

const cmd = process.platform === 'win32' ? 'cmd.exe' : 'bash';

ws.on('open', () => console.log('connected to daemon'));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'hello') console.log('daemon version', m.version);
  if (m.type === 'created') {
    sessionId = m.session.id;
    console.log('created session', sessionId, 'pid', m.session.pid);
    ws.send(JSON.stringify({ type: 'attach', id: sessionId, cols: 80, rows: 24 }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'input', id: sessionId, data: 'echo SMOKE_OK\r' })), 400);
  }
  if (m.type === 'data' && m.id === sessionId) {
    if (m.data.includes('SMOKE_OK')) gotOutput = true;
  }
  if (m.type === 'sessions') console.log('existing sessions:', m.sessions.length);
});

// Kick off: create a session running a shell so we can echo.
setTimeout(() => {
  ws.send(JSON.stringify({ type: 'create', cwd, cols: 80, rows: 24, command: cmd, name: 'smoke' }));
}, 300);

// Verify history replay, then clean up.
setTimeout(() => {
  console.log('live output received:', gotOutput);
  // Re-attach to confirm scrollback replay contains our echo.
  const off = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'history' && m.id === sessionId) {
      console.log('history replay OK:', m.data.includes('SMOKE_OK'));
      ws.off('message', off);
      ws.send(JSON.stringify({ type: 'kill', id: sessionId }));
      setTimeout(() => {
        console.log('RESULT:', gotOutput ? 'PASS' : 'FAIL');
        ws.close();
        process.exit(gotOutput ? 0 : 1);
      }, 300);
    }
  };
  ws.on('message', off);
  ws.send(JSON.stringify({ type: 'attach', id: sessionId, cols: 80, rows: 24 }));
}, 2000);
