import type { SessionInfo } from './types';

type Handler = (...args: any[]) => void;

// Thin WebSocket client for the daemon. Auto-reconnects so the UI recovers if the
// daemon restarts or the socket drops.
export class DaemonClient {
  private ws: WebSocket | null = null;
  private port = 0;
  private token = '';
  private handlers = new Map<string, Set<Handler>>();
  private queue: string[] = [];
  private closed = false;

  on(event: string, fn: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }

  private emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((fn) => fn(...args));
  }

  async connect() {
    const info = await window.csm.getDaemonInfo();
    this.port = info.port;
    this.token = info.token;
    this.open();
  }

  private open() {
    if (this.closed) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/?token=${this.token}`);
    this.ws = ws;

    ws.onopen = () => {
      this.emit('status', 'connected');
      for (const msg of this.queue) ws.send(msg);
      this.queue = [];
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      this.emit(msg.type, msg);
    };

    ws.onclose = () => {
      this.emit('status', 'disconnected');
      if (!this.closed) setTimeout(() => this.reconnect(), 800);
    };

    ws.onerror = () => ws.close();
  }

  private async reconnect() {
    try {
      // Daemon may have restarted on a new port; refresh the handshake.
      const info = await window.csm.getDaemonInfo();
      this.port = info.port;
      this.token = info.token;
    } catch {
      /* keep old values */
    }
    this.open();
  }

  private send(obj: unknown) {
    const raw = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    else this.queue.push(raw);
  }

  // ---- commands ----
  list() {
    this.send({ type: 'list' });
  }
  create(cwd: string, cols: number, rows: number, name?: string) {
    this.send({ type: 'create', cwd, cols, rows, name });
  }
  attach(id: string, cols: number, rows: number) {
    this.send({ type: 'attach', id, cols, rows });
  }
  detach(id: string) {
    this.send({ type: 'detach', id });
  }
  input(id: string, data: string) {
    this.send({ type: 'input', id, data });
  }
  resize(id: string, cols: number, rows: number) {
    this.send({ type: 'resize', id, cols, rows });
  }
  rename(id: string, name: string) {
    this.send({ type: 'rename', id, name });
  }
  kill(id: string) {
    this.send({ type: 'kill', id });
  }

  // Stop the whole daemon (and every session). Disables auto-reconnect so the renderer
  // doesn't immediately respawn it.
  shutdown() {
    this.send({ type: 'shutdown' });
    this.closed = true;
    this.ws?.close();
  }

  // Bring the daemon back (spawns a fresh one via the main process) after a shutdown.
  restart() {
    this.closed = false;
    this.connect();
  }
}

export type { SessionInfo };
