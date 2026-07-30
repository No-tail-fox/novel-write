import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist-electron/electron', { recursive: true });

const esmRequireBanner = "import { createRequire as __storydreamCreateRequire } from 'node:module'; const require = __storydreamCreateRequire(import.meta.url);";

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/electron/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'sql.js', 'undici'],
  banner: { js: esmRequireBanner },
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

await copyFile('src/shared/viral-media-worker.py', 'dist-electron/electron/viral-media-worker.py');
await copyFile(
  'node_modules/gsap/dist/gsap.min.js',
  'dist-electron/electron/gsap.min.js',
);
await copyFile(
  'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js',
  'dist-electron/electron/hyperframe.runtime.gsap.iife.js',
);
