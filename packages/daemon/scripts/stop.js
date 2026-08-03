// Stops the running daemon by reading the lock file and killing its PID.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lockPath = path.join(os.homedir(), '.claude-session-manager', 'daemon.json');

try {
  const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  process.kill(info.pid);
  fs.rmSync(lockPath, { force: true });
  console.log(`[daemon] stopped pid ${info.pid}`);
} catch (err) {
  console.log('[daemon] not running (no lock file).');
}
