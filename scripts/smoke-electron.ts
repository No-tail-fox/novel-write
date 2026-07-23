import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactProcessOutput, runBoundedProcess } from '../src/shared/process-runner';
import { formatSmokeError, runSmokeWithTempRoot, setSmokeFailureExitCode } from './smoke-signal-lifecycle';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const timeoutMs = 45_000;
const maxOutputBytes = 1024 * 1024;
const requiredAssertions = [
  'mainLoaded',
  'preloadExposed',
  'ipcStateLoaded',
  'preloadActionSucceeded',
  'windowPolicyInstalled',
  'shellRendered',
] as const;

interface SmokeReport {
  mainLoaded: boolean;
  preloadExposed: boolean;
  ipcStateLoaded: boolean;
  preloadActionSucceeded: boolean;
  windowPolicyInstalled: boolean;
  shellRendered: boolean;
}

async function main(): Promise<void> {
  const require = createRequire(join(rootDir, 'package.json'));
  const electronPath = require('electron') as string;
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(tmpdir(), 'storydream-electron-smoke-')),
    run: async ({ tempRoot, signal }) => {
      const userDataPath = join(tempRoot, 'user-data');
      const outputPath = join(userDataPath, 'smoke-result.json');
      await mkdir(userDataPath, { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'production',
        VITE_DEV_SERVER_URL: '',
        STORYDREAM_SMOKE_OUTPUT: outputPath,
        STORYDREAM_SMOKE_USER_DATA: userDataPath,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = await runBoundedProcess(electronPath, ['.'], {
        cwd: rootDir,
        env,
        signal,
        timeoutMs,
        maxStdoutBytes: maxOutputBytes,
        maxStderrBytes: maxOutputBytes,
      });
      if (child.code !== 0) {
        const detail = redactProcessOutput(child.stderr).trim().slice(-4000);
        throw new Error(`Electron smoke failed: child ${child.pid} exited with ${child.code ?? child.signal}.${detail ? `\n${detail}` : ''}`);
      }
      const report = JSON.parse(await readFile(outputPath, 'utf8')) as SmokeReport;
      const failedAssertions = requiredAssertions.filter((field) => report[field] !== true);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (failedAssertions.length > 0) throw new Error(`Electron smoke failed: ${failedAssertions.join(', ')}`);
    },
    cleanup: (tempRoot) => rm(tempRoot, { recursive: true, force: true, maxRetries: 5 }),
  });
}

void main().catch((error) => {
  process.stderr.write(`${formatSmokeError(error)}\n`);
  setSmokeFailureExitCode(process);
});
