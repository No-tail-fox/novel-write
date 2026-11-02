import { build } from 'esbuild';
await build({ entryPoints: ['scripts/smoke-stock-media-dual-output.ts'], outfile: '.artifacts/stock-media-dual-output-20261102/main.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'sql.js', 'undici'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
