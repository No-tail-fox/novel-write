// Isolated UI fixture only. Never imported by the production build or packaged app.
// Keep production license enforcement intact; these checks do not validate activation.
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const mainUrl = JSON.stringify(pathToFileURL(resolve('dist-electron/electron/main.js')).href);
await build({
  entryPoints: ['electron/main.ts'], outfile: '.artifacts/short-video-output-ui/main.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['electron', 'sql.js', 'undici'], minify: true,
  define: { 'import.meta.url': mainUrl },
  banner: { js: `import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; const require = createRequire(${mainUrl}); const __filename = fileURLToPath(${mainUrl});` },
  plugins: [{ name: 'isolated-license-fixture', setup(context) {
    context.onLoad({ filter: /[\\/]electron[\\/]license-service\.ts$/ }, () => ({ loader: 'ts', contents: `
      if (!process.env.STORYDREAM_PROJECT_QA_DIR || process.env.NODE_ENV !== 'production') throw new Error('Isolated QA profile required');
      export class LicenseService {
        config = null; transport = null;
        constructor(private options: any) {}
        status() { return { configured: true, status: 'active', deviceId: 'qa-local', deviceLabel: 'QA only', expiresAt: null, validUntil: null, devices: [], message: 'Isolated UI fixture, not production activation' }; }
        async initialize() { await this.options.onChange?.(this.status()); }
        async requireActive() {}
        async refresh() { return this.status(); }
        async activate() { throw new Error('QA disallows activation'); }
        async release() { throw new Error('QA disallows release'); }
        dispose() {}
      }
    ` }));
  } }],
});
