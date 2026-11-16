import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? '.codex-audit-temp/motion-comic-qa-bundle/electron/main.js');
const policy = resolve(dirname(output), 'qa-license-policy.ts');
await mkdir(dirname(output), { recursive: true });
await writeFile(policy, `export function needsLicense(_channel) { return false; }\n`, 'utf8');
const plugin = {
  name: 'qa-license-policy',
  setup(context) {
    context.onResolve({ filter: /^\.\/license-policy$/ }, () => ({ path: policy }));
  },
};
await build({
  entryPoints: [resolve(root, 'electron/main.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'sql.js', 'undici'],
  banner: { js: "import { createRequire as __storydreamCreateRequire } from 'node:module'; import { fileURLToPath as __storydreamFilePath } from 'node:url'; const require = __storydreamCreateRequire(import.meta.url); const __filename = __storydreamFilePath(import.meta.url);" },
  minify: true,
  plugins: [plugin],
});
console.log(output);
