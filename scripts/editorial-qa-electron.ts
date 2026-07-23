import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { editorialQaScopes, resolveEditorialQaConfig } from '../electron/editorial-qa';
import { redactProcessOutput, runBoundedProcess } from '../src/shared/process-runner';
import { formatSmokeError, runSmokeWithTempRoot, setSmokeFailureExitCode } from './smoke-signal-lifecycle';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const timeoutMs = 180_000;
const maxOutputBytes = 1024 * 1024;

interface QaReport {
  processId: number;
  ownedProcessIds: number[];
  remainingOwnedProcessIds: number[];
  captures: Array<{ path: string; theme: string; tokens: Record<string, string> }>;
}

async function main(): Promise<void> {
  const scope = readScope(process.argv.slice(2));
  const require = createRequire(join(rootDir, 'package.json'));
  const electronPath = require('electron') as string;
  let artifactDirectory = '';
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(tmpdir(), 'storydream-editorial-qa-')),
    run: async ({ tempRoot, signal }) => {
      const userData = join(tempRoot, 'user-data');
      const sentinel = join(tempRoot, '.editorial-qa-sentinel');
      const report = join(userData, 'editorial-qa-report.json');
      const captures = join(userData, 'captures');
      const token = randomBytes(32).toString('hex');
      await mkdir(userData, { recursive: true });
      await writeFile(sentinel, token, { encoding: 'utf8', flag: 'wx' });
      const qaEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'production',
        VITE_DEV_SERVER_URL: '',
        STORYDREAM_QA_RUN_ROOT: tempRoot,
        STORYDREAM_QA_RUN_TOKEN: token,
        STORYDREAM_QA_SENTINEL: sentinel,
        STORYDREAM_QA_USER_DATA: userData,
        STORYDREAM_QA_REPORT: report,
        STORYDREAM_QA_CAPTURES: captures,
        STORYDREAM_QA_SCOPE: scope,
      };
      delete qaEnvironment.ELECTRON_RUN_AS_NODE;
      delete qaEnvironment.STORYDREAM_SMOKE_OUTPUT;
      delete qaEnvironment.STORYDREAM_SMOKE_USER_DATA;
      // Parent-side parsing rejects an invalid scope before Electron is spawned.
      resolveEditorialQaConfig({
        ...qaEnvironment,
        STORYDREAM_QA_SENTINEL: sentinel,
      });
      // Recreate the consumed one-use sentinel after validation; the child consumes it for real.
      await writeFile(sentinel, token, { encoding: 'utf8', flag: 'wx' });
      const child = await runBoundedProcess(electronPath, ['.'], {
        cwd: rootDir,
        env: qaEnvironment,
        signal,
        timeoutMs,
        maxStdoutBytes: maxOutputBytes,
        maxStderrBytes: maxOutputBytes,
      });
      if (child.code !== 0) {
        const detail = redactProcessOutput(child.stderr).trim().slice(-4000);
        throw new Error(`Editorial QA Electron child ${child.pid} exited with ${child.code ?? child.signal}.${detail ? `\n${detail}` : ''}`);
      }
      const qaReport = JSON.parse(await readFile(report, 'utf8')) as QaReport;
      const remaining = await remainingOwnedProcesses(qaReport.ownedProcessIds, 5_000);
      if (qaReport.processId <= 0 || qaReport.remainingOwnedProcessIds.length || remaining.length) {
        throw new Error(`Editorial QA left owned processes alive: ${remaining.join(', ') || qaReport.remainingOwnedProcessIds.join(', ')}`);
      }
      if (!qaReport.captures.length) throw new Error('Editorial QA did not produce any captures.');
      if (scope === 'theme-smoke') validateThemeSmoke(qaReport);
      artifactDirectory = await mkdtemp(join(tmpdir(), 'storydream-editorial-artifacts-'));
      await copyFile(report, join(artifactDirectory, 'report.json'));
      await mkdir(join(artifactDirectory, 'captures'));
      for (const capture of qaReport.captures) {
        if (basename(capture.path) !== capture.path) throw new Error('Editorial QA report contains an unsafe capture name.');
        await copyFile(join(captures, capture.path), join(artifactDirectory, 'captures', capture.path));
      }
    },
    cleanup: (tempRoot) => rm(tempRoot, { recursive: true, force: true, maxRetries: 5 }),
  });
  process.stdout.write(`Editorial QA artifacts: ${artifactDirectory}\n`);
}

function validateThemeSmoke(report: QaReport): void {
  const light = report.captures.find((capture) => capture.theme === 'light');
  const dark = report.captures.find((capture) => capture.theme === 'dark');
  if (!light || !dark) throw new Error('Editorial theme smoke requires light and dark captures.');
  for (const name of ['--shell-bg', '--shell-surface', '--shell-border', '--shell-text', '--shell-muted']) {
    if (!light.tokens[name] || !dark.tokens[name] || light.tokens[name] === dark.tokens[name]) {
      throw new Error(`Editorial shell token did not change across themes: ${name}`);
    }
  }
  for (const name of ['--media-bg', '--media-surface', '--media-border', '--media-text', '--media-muted']) {
    if (!light.tokens[name] || light.tokens[name] !== dark.tokens[name]) {
      throw new Error(`Editorial media token changed across themes: ${name}`);
    }
  }
}

function readScope(args: readonly string[]): string {
  const values = args.filter((value) => value.startsWith('--scope='));
  if (args.length !== values.length || values.length > 1) throw new Error('Usage: editorial-qa-electron.ts [--scope=<scope>]');
  const scope = values[0]?.slice('--scope='.length) || 'all';
  if (!editorialQaScopes.includes(scope as (typeof editorialQaScopes)[number])) {
    throw new Error(`Unknown editorial QA scope: ${scope}`);
  }
  return scope;
}

async function remainingOwnedProcesses(pids: readonly number[], timeoutMs: number): Promise<number[]> {
  const unique = [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  let remaining = unique.filter(isProcessAlive);
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    remaining = unique.filter(isProcessAlive);
  }
  return remaining;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(`${formatSmokeError(error)}\n`);
  setSmokeFailureExitCode(process);
});
