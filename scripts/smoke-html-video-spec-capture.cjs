// Run: I:\nodejs\node.exe scripts/smoke-html-video-spec-capture.cjs
// Offline real Electron capture; all artifacts/profiles remain in repository .tmp.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(root, '.tmp', 'html-spec-capture-'));
  const bundle = path.join(scratch, 'lib.cjs');
  await require('esbuild').build({ stdin: { contents: "export { CaptureHost } from './electron/capture-host'; export { createElectronCaptureWindowFactory } from './electron/capture-host-electron'; export { htmlVideoSpecCaptureRequestAllowed } from './electron/html-video-spec-render'; export { buildHtmlVideoExportInput } from './src/shared/html-video';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: bundle, logLevel: 'silent' });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA']) { env[key] = path.join(scratch, key); fs.mkdirSync(env[key], { recursive: true }); }
  console.log('Electron smoke scratch:', scratch);
  const result = spawnSync(require('electron'), [path.join(__dirname, 'smoke-html-video-spec-capture-runner.cjs'), `--user-data-dir=${path.join(scratch, 'profile')}`, scratch], { env, stdio: 'inherit', timeout: 60000, windowsHide: true, cwd: root });
  const report = path.join(scratch, 'result.json');
  if (fs.existsSync(report)) console.log(fs.readFileSync(report, 'utf8'));
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
