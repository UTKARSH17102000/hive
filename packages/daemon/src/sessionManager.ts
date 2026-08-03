// Owns the lifecycle of every Claude PTY session. Survives app close because the
// daemon process it lives in is detached from the Electron window.
import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionInfo } from './protocol.js';

const SCROLLBACK_BYTES = 1_000_000; // ~1MB of replayable output per session

// How long a background session must sit silent after producing output before we treat
// it as "finished its turn / waiting for you" and raise an attention flag.
const IDLE_ATTENTION_MS = 700;

// The command used to launch Claude Code. Overridable per-session (and later via config).
const DEFAULT_COMMAND = process.env.CSM_CLAUDE_COMMAND || 'claude';

interface Session {
  info: SessionInfo;
  proc: pty.IPty;
  buffer: string; // rolling scrollback for reattach
  focusCount: number; // how many clients are actively viewing this session
  idleTimer?: ReturnType<typeof setTimeout>;
  bgOutput: boolean; // produced output since it was last focused
}

type OutputListener = (id: string, data: string) => void;
type ExitListener = (id: string, code: number) => void;
type AttentionListener = (id: string, attention: boolean) => void;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private outputListeners = new Set<OutputListener>();
  private exitListeners = new Set<ExitListener>();
  private attentionListeners = new Set<AttentionListener>();

  onOutput(fn: OutputListener) {
    this.outputListeners.add(fn);
    return () => this.outputListeners.delete(fn);
  }

  onExit(fn: ExitListener) {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  onAttention(fn: AttentionListener) {
    this.attentionListeners.add(fn);
    return () => this.attentionListeners.delete(fn);
  }

  private setAttention(session: Session, value: boolean) {
    if (session.info.attention === value) return;
    session.info.attention = value;
    for (const fn of this.attentionListeners) fn(session.info.id, value);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  history(id: string): string {
    return this.sessions.get(id)?.buffer ?? '';
  }

  create(opts: {
    cwd: string;
    name?: string;
    cols: number;
    rows: number;
    command?: string;
  }): SessionInfo {
    const id = randomUUID();
    const isWindows = process.platform === 'win32';

    // node-pty (ConPTY/CreateProcess) does NOT do a PATH+PATHEXT lookup the way a shell
    // does, so a bare "claude" fails with "File not found" on Windows. Resolve it to a
    // concrete executable first, and wrap .cmd/.bat/.ps1 shims in their interpreter.
    const launch = resolveLaunch(opts.command || DEFAULT_COMMAND);

    const proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cwd: opts.cwd,
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      env: { ...process.env } as Record<string, string>,
      useConpty: isWindows
    });

    const info: SessionInfo = {
      id,
      name: opts.name?.trim() || defaultName(opts.cwd),
      cwd: opts.cwd,
      pid: proc.pid,
      status: 'running',
      createdAt: Date.now(),
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      attention: false
    };

    const session: Session = { info, proc, buffer: '', focusCount: 0, bgOutput: false };
    this.sessions.set(id, session);

    proc.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > SCROLLBACK_BYTES) {
        session.buffer = session.buffer.slice(session.buffer.length - SCROLLBACK_BYTES);
      }
      for (const fn of this.outputListeners) fn(id, data);
      this.trackActivity(session, data);
    });

    proc.onExit(({ exitCode }) => {
      session.info.status = 'exited';
      session.info.exitCode = exitCode;
      if (session.idleTimer) clearTimeout(session.idleTimer);
      // An exited background session is worth surfacing too.
      if (session.focusCount === 0) this.setAttention(session, true);
      for (const fn of this.exitListeners) fn(id, exitCode);
    });

    return info;
  }

  // Decide whether a background session deserves an attention flag. While a session is
  // being viewed (focusCount > 0) we never flag it. Otherwise: raise immediately if the
  // chunk clearly contains a prompt, else raise once it goes quiet for IDLE_ATTENTION_MS.
  private trackActivity(session: Session, data: string) {
    if (session.focusCount > 0) return;
    session.bgOutput = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);

    if (looksLikePrompt(data)) {
      this.setAttention(session, true);
      return;
    }
    session.idleTimer = setTimeout(() => {
      if (session.focusCount === 0 && session.bgOutput) this.setAttention(session, true);
    }, IDLE_ATTENTION_MS);
  }

  // Called when a client starts / stops viewing a session.
  focus(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.focusCount += 1;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.bgOutput = false;
    this.setAttention(s, false);
  }

  unfocus(id: string) {
    const s = this.sessions.get(id);
    if (s && s.focusCount > 0) s.focusCount -= 1;
  }

  write(id: string, data: string) {
    this.sessions.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      s.proc.resize(Math.max(cols, 1), Math.max(rows, 1));
      s.info.cols = cols;
      s.info.rows = rows;
    } catch {
      /* pty may have exited */
    }
  }

  rename(id: string, name: string) {
    const s = this.sessions.get(id);
    if (s) s.info.name = name.trim() || s.info.name;
  }

  kill(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    try {
      s.proc.kill();
    } catch {
      /* already gone */
    }
    this.sessions.delete(id);
  }
}

// Strong, immediate signals that Claude is asking the user something.
const PROMPT_PATTERNS = [
  /do you want to proceed/i,
  /do you want to/i,
  /\bpress\b.*\bto continue\b/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /❯\s*\d+\./, // numbered selection menu
  /\b1\.\s.*\b2\.\s/i // inline "1. Yes 2. No" style choices
];

function looksLikePrompt(data: string): boolean {
  const text = stripAnsi(data);
  return PROMPT_PATTERNS.some((re) => re.test(text));
}

// Remove ANSI escape / control sequences so pattern matching sees plain text.
function stripAnsi(input: string): string {
  return input
    // CSI, OSC and other escape sequences
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f]/g, '');
}

function defaultName(cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;
  return `${base} · ${new Date().toLocaleTimeString()}`;
}

interface Launch {
  file: string;
  args: string[];
}

// Turn a command name into something node-pty can actually spawn.
function resolveLaunch(command: string): Launch {
  const isWindows = process.platform === 'win32';
  const hasSep = command.includes('/') || command.includes('\\');
  const resolved = (hasSep ? command : which(command)) || command;

  if (isWindows) {
    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      return { file: process.env.ComSpec || 'cmd.exe', args: ['/c', resolved] };
    }
    if (ext === '.ps1') {
      return { file: 'powershell.exe', args: ['-ExecutionPolicy', 'Bypass', '-File', resolved] };
    }
  }
  return { file: resolved, args: [] };
}

// Minimal cross-platform PATH lookup (honours PATHEXT on Windows).
function which(cmd: string): string | null {
  const isWindows = process.platform === 'win32';
  const exts = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const alreadyHasExt = isWindows && exts.includes(path.extname(cmd).toLowerCase());

  for (const dir of dirs) {
    if (!dir) continue;
    const candidates = alreadyHasExt ? [cmd] : [cmd, ...exts.map((e) => cmd + e)];
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

export { os };
