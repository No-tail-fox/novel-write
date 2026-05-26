import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-electron/electron', { recursive: true });

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/electron/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'sql.js'],
  sourcemap: false,
});

await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/electron/preload.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
});
