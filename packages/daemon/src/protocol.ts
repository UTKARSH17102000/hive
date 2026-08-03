// Shared message protocol between the Electron renderer and the daemon.
// Kept dependency-free so it can be imported by both sides.

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  pid: number;
  status: 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
  cols: number;
  rows: number;
  // True when a background (not-currently-viewed) session finished a turn / is waiting
  // for input. Cleared as soon as the user focuses the session.
  attention: boolean;
}

// ---- Client -> Daemon ----
export type ClientMessage =
  | { type: 'list' }
  | { type: 'create'; cwd: string; name?: string; cols: number; rows: number; command?: string }
  | { type: 'attach'; id: string; cols: number; rows: number }
  | { type: 'detach'; id: string }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'shutdown' };

// ---- Daemon -> Client ----
export type ServerMessage =
  | { type: 'hello'; version: string }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'created'; session: SessionInfo }
  | { type: 'history'; id: string; data: string }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number }
  | { type: 'session-added'; session: SessionInfo }
  | { type: 'session-removed'; id: string }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'activity'; id: string; attention: boolean }
  | { type: 'error'; message: string };

export const DAEMON_VERSION = '0.1.0';

// Fixed loopback port. Binding it is what enforces a single daemon instance: if the port
// is already taken, another daemon is alive and the new process exits. This makes orphan
// daemons impossible even if the lock file is deleted.
export const DAEMON_PORT = 47615;
