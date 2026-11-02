import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const resources = resolve(argument('--resources') || join(root, 'release/StoryDream-Portable/resources'));
const output = resolve(argument('--output') || join(root, '.artifacts/lemo-release/package-qa-' + Date.now()));
const temporary = join(output, 'temp'); await mkdir(temporary, { recursive: true });
const apiPath = join(output, 'release-api.mjs'), qaPath = join(output, 'qa-runner.mjs');
for (const [source, target] of [['electron/lemo-official-release.ts', apiPath], ['scripts/qa-lemo-package.ts', qaPath]]) {
  await build({ absWorkingDir: root, entryPoints: [source], outfile: target, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
}
const { resolvePackagedLemoRelease } = await import(pathToFileURL(apiPath).href);
const release = await resolvePackagedLemoRelease(resources);
const env = { TEMP: temporary, TMP: temporary, TMPDIR: temporary, HOME: join(output, 'home'), USERPROFILE: join(output, 'home'),
  APPDATA: join(output, 'appdata'), LOCALAPPDATA: join(output, 'localappdata') };
for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'SystemDrive']) if (process.env[name]) env[name] = process.env[name];
// The SDK receives only its bundled Node directory. System32 can contain WSL's
// bash.exe, so it must not be part of the no-global-shell SDK acceptance path.
env.PATH = dirname(release.nodeExecutable);
execFileSync(release.nodeExecutable, [qaPath, resources, output], { env, cwd: output, shell: false, windowsHide: true,
  stdio: 'inherit', timeout: 150000 });

// Reuse the established real-SDK start/resume/cancel harness, changing only its isolated paths.
const sessionSourcePath = join(root, 'services/lemo-agent-worker/offline-session-smoke.ts');
let source = await readFile(sessionSourcePath, 'utf8');
const replacements = [
  ["resolve('.artifacts/lemo-session-20261102')", JSON.stringify(join(output, 'session'))],
  ["resolve('services/lemo-agent-worker/dist/worker.mjs')", JSON.stringify(release.workerPath)],
  ["resolve('vendor/lemo-upstream')", JSON.stringify(join(resources, 'lemo-upstream'))],
];
for (const [before, after] of replacements) {
  if (source.split(before).length !== 2) throw Error('LEMO_PACKAGE_SESSION_HARNESS_CHANGED');
  source = source.replace(before, after);
}
const sessionPath = join(output, 'session-runner.mjs');
await build({ stdin: { contents: source, sourcefile: sessionSourcePath, resolveDir: dirname(sessionSourcePath), loader: 'ts' },
  outfile: sessionPath, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
execFileSync(release.nodeExecutable, [sessionPath], { env, cwd: output, shell: false, windowsHide: true,
  stdio: 'inherit', timeout: 180000 });
const session = JSON.parse(await readFile(join(output, 'session/offline-session-report.json'), 'utf8'));
if (session.status !== 'passed' || session.requests.length !== 3 || session.paidRequests !== 0) throw Error('LEMO_PACKAGE_SESSION_FAILED');
const finalRelease = await resolvePackagedLemoRelease(resources);
if (finalRelease.manifestSha256 !== release.manifestSha256) throw Error('LEMO_PACKAGE_RELEASE_CHANGED_DURING_QA');

const app = join(dirname(resources), 'StoryDream.exe');
let applicationSmoke = 'not-present';
if (await stat(app).then(value => value.isFile(), () => false)) {
  const userData = join(output, 'electron-smoke/user-data'), result = join(userData, 'smoke-result.json');
  await mkdir(userData, { recursive: true });
  execFileSync(app, [], { env: { ...env,
    PATH: env.PATH + ';' + join(process.env.SystemRoot || 'C:/Windows', 'System32'),
    NODE_ENV: 'production', VITE_DEV_SERVER_URL: '',
    STORYDREAM_SMOKE_USER_DATA: userData, STORYDREAM_SMOKE_OUTPUT: result },
    cwd: dirname(app), shell: false, windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  const smoke = JSON.parse(await readFile(result, 'utf8'));
  const assertions = smoke.mode === 'license-gate'
    ? ['mainLoaded', 'preloadExposed', 'windowPolicyInstalled', 'licenseStatusLoaded', 'licenseGateRendered', 'protectedIpcBlocked']
    : ['mainLoaded', 'preloadExposed', 'ipcStateLoaded', 'preloadActionSucceeded', 'windowPolicyInstalled', 'shellRendered'];
  for (const name of assertions) {
    if (smoke[name] !== true) throw Error('LEMO_PACKAGE_APPLICATION_SMOKE_' + name);
  }
  if (smoke.mode === 'license-gate' && (smoke.shellRendered !== false || smoke.ipcStateLoaded !== false
    || smoke.preloadActionSucceeded !== false || ['active', 'offline'].includes(smoke.licenseStatus))) {
    throw Error('LEMO_PACKAGE_UNLICENSED_WORKSPACE_MUST_REMAIN_BLOCKED');
  }
  applicationSmoke = smoke.mode === 'license-gate' ? 'passed-license-gate' : 'passed-workspace';
}
const summary = { status: 'passed', runtime: join(output, 'report.json'), session: join(output, 'session/offline-session-report.json'),
  manifestSha256: release.manifestSha256, finalManifestVerified: true, applicationSmoke,
  authorizedWorkspaceVerified: applicationSmoke === 'passed-workspace', localProviderRequests: session.requests.length,
  paidRequests: 0, globalNodeRequired: false, globalGitBashRequired: false,
  sdkSearchPath: env.PATH, cleanMachineVerified: false };
await writeFile(join(output, 'qa-summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary));
