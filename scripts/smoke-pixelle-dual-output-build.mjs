import { build } from 'esbuild';
import { resolve } from 'node:path';
const outfile = process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT
  ? resolve(process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT, 'runtime', 'pixelle-dual-output.mjs')
  : '.artifacts/pixelle-dual-output-smoke/main.mjs';
await build({ entryPoints: ['scripts/smoke-pixelle-dual-output.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'sql.js', 'undici'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
