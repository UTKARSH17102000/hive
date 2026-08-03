import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const CONFIG_DIR = path.join(os.homedir(), '.claude-session-manager');
const LOCK_PATH = path.join(CONFIG_DIR, 'daemon.json');
// Must match packages/daemon/src/protocol.ts DAEMON_PORT.
const DAEMON_PORT = 47615;

interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
}

function readLock(): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function daemonEntry(): string {
  // Packaged: daemon ships as an unpacked resource (real file, spawnable by node).
  if (app.isPackaged) return path.join(process.resourcesPath, 'daemon', 'dist', 'daemon.cjs');
  // Dev: app.getAppPath() -> packages/app ; daemon bundle sits next door.
  return path.resolve(app.getAppPath(), '..', 'daemon', 'dist', 'daemon.cjs');
}

// Spawn the daemon as a DETACHED system-Node process so it outlives this window.
function spawnDaemon(): void {
  const entry = daemonEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Daemon bundle missing at ${entry}. Run "npm run build:daemon".`);
  }
  const child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [entry], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: os.homedir()
  });
  child.unref();
}

async function ensureDaemon(): Promise<DaemonInfo> {
  // The port is the source of truth. If a healthy daemon already owns it, reuse it and
  // read its token from the lock file — never spawn a second one.
  if (await probe(DAEMON_PORT)) {
    const info = readLock();
    if (info) return info;
  }

  spawnDaemon();

  // Wait for the daemon to bind the port and write its lock file (with the token).
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probe(DAEMON_PORT)) {
      const info = readLock();
      if (info) return info;
    }
    await delay(150);
  }
  throw new Error('Daemon did not start in time.');
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- IPC ----
ipcMain.handle('daemon:info', async () => ensureDaemon());

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:subfolders', async (_e, root: string) => {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, path: path.join(root, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});

// ---- Window ----
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Hive',
    backgroundColor: '#19181a',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window does NOT stop the daemon — that is the whole point.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
