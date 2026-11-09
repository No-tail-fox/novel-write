import { build } from 'esbuild';
await build({ entryPoints: ['scripts/smoke-short-video-materials.ts'], outfile: '.artifacts/short-video-materials-smoke/main.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'sql.js', 'undici'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
