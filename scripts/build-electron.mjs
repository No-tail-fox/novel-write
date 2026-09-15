import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist-electron/electron', { recursive: true });

const esmRequireBanner = "import { createRequire as __storydreamCreateRequire } from 'node:module'; import { fileURLToPath as __storydreamFilePath } from 'node:url'; const require = __storydreamCreateRequire(import.meta.url); const __filename = __storydreamFilePath(import.meta.url);";

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
await copyFile('src/shared/remove-background-worker.py', 'dist-electron/electron/remove-background-worker.py');
await copyFile(
  'node_modules/gsap/dist/gsap.min.js',
  'dist-electron/electron/gsap.min.js',
);
await copyFile(
  'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js',
  'dist-electron/electron/hyperframe.runtime.gsap.iife.js',
);

await build({entryPoints: ['src/features/vox-animation/runtime.tsx'], outfile: 'dist-electron/electron/vox-animation-runtime.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', define: {'process.env.NODE_ENV': '"production"'}, minify: true});
await copyFile('src/features/vox-animation/THIRD_PARTY_NOTICES.md', 'dist-electron/electron/VOX_THIRD_PARTY_NOTICES.md');
