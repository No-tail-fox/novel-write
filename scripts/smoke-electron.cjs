const { spawn, spawnSync } = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const electronPath = require('electron');
const rootDir = join(__dirname, '..');
const timeoutMs = 45000;
const maxOutputBytes = 1024 * 1024;
const requiredAssertions = [
  'mainLoaded',
  'preloadExposed',
  'ipcStateLoaded',
  'preloadActionSucceeded',
  'windowPolicyInstalled',
  'shellRendered',
];

function appendBounded(current, chunk) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length <= maxOutputBytes ? next : next.subarray(0, maxOutputBytes);
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5000,
    });
    return;
  }
  child.kill('SIGKILL');
}

function runElectron(userDataPath, outputPath) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    const childEnvironment = {
      ...process.env,
      NODE_ENV: 'production',
      VITE_DEV_SERVER_URL: '',
      STORYDREAM_SMOKE_OUTPUT: outputPath,
      STORYDREAM_SMOKE_USER_DATA: userDataPath,
    };
    delete childEnvironment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, ['.'], {
      cwd: rootDir,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
    });
  });
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'storydream-electron-smoke-'));
  const userDataPath = join(tempRoot, 'user-data');
  const outputPath = join(userDataPath, 'smoke-result.json');
  await mkdir(userDataPath, { recursive: true });

  try {
    const childResult = await runElectron(userDataPath, outputPath);
    if (childResult.timedOut) {
      throw new Error(`Electron smoke failed: application exceeded ${timeoutMs}ms.`);
    }
    if (childResult.code !== 0) {
      const detail = childResult.stderr.trim().slice(-4000);
      throw new Error(`Electron smoke failed: child exited with ${childResult.code ?? childResult.signal}.${detail ? `\n${detail}` : ''}`);
    }

    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    const failedAssertions = requiredAssertions.filter((field) => report[field] !== true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failedAssertions.length > 0) {
      throw new Error('Electron smoke failed: ' + failedAssertions.join(', '));
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
