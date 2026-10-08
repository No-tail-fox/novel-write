import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const out = '.artifacts/director-retry-qa';
await mkdir(out, { recursive: true });
await build({ entryPoints: ['tests/director-retry.harness.tsx'], outfile: `${out}/harness.js`, bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'file', '.png': 'file' }, logLevel: 'warning' });
await writeFile(`${out}/index.html`, '<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>', 'utf8');
console.log(`Prepared ${out}`);
