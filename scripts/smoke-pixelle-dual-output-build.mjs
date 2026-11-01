import { build } from 'esbuild';
await build({ entryPoints: ['scripts/smoke-pixelle-dual-output.ts'], outfile: '.artifacts/pixelle-dual-output-smoke/main.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'sql.js', 'undici'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
