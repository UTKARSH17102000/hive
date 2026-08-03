// Bundles the daemon TypeScript into a single CJS file that can be spawned by
// system Node. node-pty is kept external (native module resolved at runtime).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(root, 'dist', 'daemon.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['node-pty'],
  logLevel: 'info'
});

console.log('[daemon] built -> dist/daemon.cjs');
