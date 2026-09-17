import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('dist-electron/electron', { recursive: true });
await rm('dist-electron/electron/agent-search-mcp-server.mjs', { force: true });

const esmRequireBanner = "import { createRequire as __storydreamCreateRequire } from 'node:module'; import { fileURLToPath as __storydreamFilePath } from 'node:url'; const require = __storydreamCreateRequire(import.meta.url); const __filename = __storydreamFilePath(import.meta.url);";
const agentSearchPackage = JSON.parse(await readFile('node_modules/agent-search-mcp/package.json', 'utf8'));
const agentSearchVersion = String(agentSearchPackage.version);

const agentSearchVersionPlugin = {
  name: 'storydream-agent-search-version',
  setup(context) {
    context.onLoad({ filter: /[\\/]agent-search-mcp[\\/]dist[\\/]infrastructure[\\/]version-check\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const functionStart = source.indexOf('export function readCurrentVersion');
      const constantStart = source.indexOf('const CURRENT_VERSION', functionStart);
      if (functionStart < 0 || constantStart < 0) throw new Error('Unable to inject the Agent Search package version.');
      return {
        contents: `${source.slice(0, functionStart)}export function readCurrentVersion() { return ${JSON.stringify(agentSearchVersion)}; }\n${source.slice(constantStart)}`,
        loader: 'js',
      };
    });
  },
};

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

const agentSearchBuild = await build({
  entryPoints: ['node_modules/agent-search-mcp/dist/index.js'],
  outfile: 'dist-electron/electron/agent-search-mcp-server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  banner: {
    js: "const { pathToFileURL: __storydreamPathToFileURL } = require('node:url'); const __storydreamAgentSearchModuleUrl = __storydreamPathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__storydreamAgentSearchModuleUrl',
  },
  plugins: [agentSearchVersionPlugin],
  metafile: true,
  sourcemap: false,
});

await copyFile('src/shared/viral-media-worker.py', 'dist-electron/electron/viral-media-worker.py');
await copyFile('node_modules/agent-search-mcp/LICENSE', 'dist-electron/electron/AGENT_SEARCH_LICENSE.txt');
await writeAgentSearchThirdPartyNotices(agentSearchBuild.metafile.inputs);
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
await mkdir('dist-electron/electron/shotcraft', { recursive: true });
await copyFile('src/features/vox-animation/shotcraft/LICENSE', 'dist-electron/electron/shotcraft/LICENSE');

async function writeAgentSearchThirdPartyNotices(inputs) {
  const packageRoots = new Set();
  for (const input of Object.keys(inputs)) {
    const normalized = input.replaceAll('\\', '/');
    const markerIndex = normalized.lastIndexOf('node_modules/');
    if (markerIndex < 0) continue;
    const prefix = normalized.slice(0, markerIndex + 'node_modules/'.length);
    const segments = normalized.slice(markerIndex + 'node_modules/'.length).split('/');
    const packageSegments = segments[0]?.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1);
    if (packageSegments.length > 0 && packageSegments.every(Boolean)) packageRoots.add(resolve(prefix, ...packageSegments));
  }

  const notices = [];
  for (const packageRoot of packageRoots) {
    const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    const entries = await readdir(packageRoot, { withFileTypes: true });
    const licenseFiles = entries
      .filter((entry) => entry.isFile() && /^(?:license|copying|notice)(?:[.\-_].*)?$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    const repository = typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url;
    const metadata = [
      `## ${packageJson.name ?? packageRoot}@${packageJson.version ?? 'unknown'}`,
      `Declared license: ${packageJson.license ?? 'not declared'}`,
      repository || packageJson.homepage ? `Source: ${repository || packageJson.homepage}` : '',
    ].filter(Boolean);
    for (const filename of licenseFiles) {
      metadata.push('', `--- ${filename} ---`, (await readFile(resolve(packageRoot, filename), 'utf8')).trim());
    }
    notices.push({ name: String(packageJson.name ?? packageRoot), text: metadata.join('\n') });
  }

  notices.sort((left, right) => left.name.localeCompare(right.name));
  const header = [
    'StoryDream Agent Search bundled third-party notices',
    '',
    'The packages below are included in agent-search-mcp-server.cjs.',
    'Each package remains subject to its own license terms.',
    '',
  ].join('\n');
  await writeFile(
    'dist-electron/electron/AGENT_SEARCH_THIRD_PARTY_NOTICES.txt',
    `${header}\n${notices.map((notice) => notice.text).join('\n\n')}\n`,
    'utf8',
  );
}
