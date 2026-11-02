import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildLemoAgentWorker } from './build-lemo-agent-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('LEMO_RELEASE_REQUIRES_WINDOWS_X64');
const cache = join(root, '.cache/lemo-release');
const temp = join(cache, 'temp');
const artifacts = join(root, '.artifacts/lemo-release');
const installationRoot = join(artifacts, 'resources/lemo-official');
await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true });
const free = await statfs(root);
if (free.bavail * free.bsize < 3 * 1024 ** 3) throw Error('LEMO_RELEASE_DISK_SPACE: At least 3 GiB of build workspace is required.');
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, npm_config_cache: join(cache, 'npm'),
  ELECTRON_CACHE: join(cache, 'electron'), ELECTRON_BUILDER_CACHE: join(cache, 'electron-builder') };
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[key];
const modulePath = join(artifacts, 'release-api.mjs');
await build({ entryPoints: ['electron/lemo-official-release.ts'], outfile: modulePath, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const api = await import(pathToFileURL(modulePath).href);
const spec = JSON.parse(await readFile('scripts/lemo-release-downloads.json', 'utf8'));
if (spec.schema !== 1 || spec.sdkVersion !== '0.3.314' || spec.cliVersion !== '2.1.314'
  || spec.platform !== 'win32' || spec.arch !== 'x64' || !/^v22\.\d+\.\d+$/.test(spec.node.version)
  || !/^[a-f0-9]{64}$/.test(spec.node.sha256) || !/^node-v22\.\d+\.\d+-win-x64\.zip$/.test(spec.node.archive)) throw Error('LEMO_RELEASE_DOWNLOAD_SPEC');

async function nodeArchive() {
  const destination = join(cache, spec.node.archive);
  const receipt = async source => writeFile(join(cache, 'node-archive-verification.json'), JSON.stringify({
    version: spec.node.version, archive: spec.node.archive, sha256: spec.node.sha256, source,
    configuredSources: spec.node.urls, verifiedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  try { if (await api.hashLemoReleaseFile(destination) === spec.node.sha256) { await receipt('preexisting-verified-cache'); return destination; } }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const url of spec.node.urls) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['nodejs.org', 'npmmirror.com'].includes(parsed.hostname)) throw Error('LEMO_RELEASE_DOWNLOAD_ORIGIN');
    const temporary = destination + '.' + randomUUID() + '.part';
    try {
      console.log('[lemo-release] Downloading pinned Node archive from ' + parsed.hostname);
      const response = await fetch(url, { signal: AbortSignal.timeout(parsed.hostname === 'nodejs.org' ? 15000 : 120000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 120 * 1024 ** 2) throw Error('LEMO_RELEASE_DOWNLOAD_FAILED');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 120 * 1024 ** 2) throw Error('LEMO_RELEASE_DOWNLOAD_LIMIT');
      await writeFile(temporary, bytes, { flag: 'wx' });
      if (await api.hashLemoReleaseFile(temporary) !== spec.node.sha256) throw Error('LEMO_RELEASE_DOWNLOAD_INTEGRITY');
      await rename(temporary, destination); await receipt(url); return destination;
    } catch (error) { console.log('[lemo-release] Download attempt failed: ' + error.message); }
    finally { await rm(temporary, { force: true }); }
  }
  throw Error('LEMO_RELEASE_NODE_DOWNLOAD_FAILED');
}

const candidate = join(artifacts, '.candidate-' + randomUUID());
await mkdir(candidate);
try {
  const archive = await nodeArchive();
  execFileSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/extract-lemo-node.ps1'),
      '-Archive', archive, '-Destination', join(candidate, 'node'), '-Version', spec.node.version], { env, stdio: 'inherit', windowsHide: true });
  const worker = join(candidate, 'lemo-agent-worker'); await mkdir(worker);
  for (const file of ['package.json', 'package-lock.json']) await copyFile(join(root, 'services/lemo-agent-worker', file), join(worker, file));
  const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!(await stat(npm)).isFile()) throw Error('LEMO_RELEASE_BUILD_NPM_REQUIRED');
  console.log('[lemo-release] Installing only the exact worker lockfile (scripts disabled).');
  let installed = false;
  for (const registry of ['https://registry.npmjs.org', 'https://registry.npmmirror.com']) {
    try {
      execFileSync(join(candidate, 'node/node.exe'), [npm, 'ci', '--prefix', worker, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
        '--fetch-timeout=15000', '--fetch-retries=0', '--maxsockets=16', '--update-notifier=false', '--registry=' + registry, '--cache', env.npm_config_cache],
        { env, stdio: 'inherit', windowsHide: true, timeout: 240000 });
      installed = true; break;
    } catch { console.log('[lemo-release] Locked dependency install failed at ' + registry + '; lockfile integrity remains mandatory.'); }
  }
  if (!installed) throw Error('LEMO_RELEASE_LOCKED_INSTALL_FAILED');
  await buildLemoAgentWorker(join(worker, 'dist/worker.mjs'));
  const manifest = { schema: 1, platform: 'win32', arch: 'x64', sdkVersion: spec.sdkVersion, cliVersion: spec.cliVersion,
    nodeVersion: spec.node.version, workerLockSha256: await api.hashLemoReleaseFile(join(worker, 'package-lock.json')),
    files: await api.listLemoReleaseFiles(candidate) };
  await writeFile(join(candidate, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const digest = await api.hashLemoReleaseFile(join(candidate, 'manifest.json'));
  const pointer = await api.activateLemoRelease({ sourceRoot: candidate, installationRoot, trustedManifestSha256: digest });
  const release = await api.resolvePackagedLemoRelease(join(artifacts, 'resources'));
  await api.probeLemoRelease(release);
  const report = { schema: 1, completedAt: new Date().toISOString(), manifestSha256: digest, pointer,
    sdkVersion: spec.sdkVersion, cliVersion: spec.cliVersion, nodeVersion: spec.node.version,
    fileCount: manifest.files.length, totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
    nodeArchiveSha256: spec.node.sha256, installedResourceRoot: installationRoot,
    paidRequests: 0, globalNodeRequired: false, cleanMachineVerified: false };
  await writeFile(join(artifacts, 'preparation-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report));
} finally { await rm(candidate, { recursive: true, force: true }); }
