import { app, utilityProcess } from 'electron';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
await app.whenReady();
const root = await mkdtemp(path.join(tmpdir(), 'pi-utility-smoke-'));
const project = path.join(root, 'project'), sessions = path.join(root, 'sessions');
await mkdir(project); await mkdir(sessions);
let child;
try {
  const worker = app.isPackaged
    ? path.join(process.resourcesPath, 'pi-agent-worker', 'dist', 'worker.mjs')
    : fileURLToPath(new URL('../services/pi-agent-worker/dist/worker.mjs', import.meta.url));
  child = utilityProcess.fork(worker, [], { cwd: project, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, TEMP: root, TMP: root, NO_COLOR: '1' }, stdio: 'ignore' });
  const messages = [];
  const started = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('utility worker startup timeout')), 30000);
    child.on('message', message => {
      messages.push(message.type);
      if (message.id !== 'start') return;
      clearTimeout(timer);
      if (message.type === 'error') reject(new Error(message.error)); else resolve(message);
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('utility worker exited: ' + code)); });
    child.postMessage({ id: 'start', type: 'start', config: { cwd: project, sessionDir: sessions,
      gatewayBaseUrl: 'http://127.0.0.1:1', gatewayToken: 'no-paid-requests', modelId: 'fixture',
      api: 'anthropic-messages', systemPrompt: 'Offline startup smoke.', tools: [], maxTokens: 1024, contextWindow: 8192 } });
  });
  if (started.type !== 'started') throw new Error('Unexpected worker message');
  await new Promise((resolve, reject) => {
    let acknowledged = false;
    const timer = setTimeout(() => reject(new Error('utility worker shutdown timeout')), 5000);
    child.on('message', message => {
      if (message.id !== 'stop' || message.type !== 'shutdown') return;
      acknowledged = true;
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0 && acknowledged) resolve();
      else reject(new Error(`utility worker shutdown failed: code=${code}, acknowledged=${acknowledged}`));
    });
    child.postMessage({ id: 'stop', type: 'shutdown' });
  });
  child = undefined;
  const evidence = { passed: true, transport: 'utilityProcess.parentPort', paidRequests: 0, messages };
  if (process.env.PI_UTILITY_SMOKE_RECEIPT) await writeFile(process.env.PI_UTILITY_SMOKE_RECEIPT, JSON.stringify(evidence), 'utf8');
  console.log(JSON.stringify(evidence));
} finally {
  if (child) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  await rm(root, { recursive: true, force: true });
  app.quit();
}
}
void main().catch(error => { console.error(error); app.exit(1); });
