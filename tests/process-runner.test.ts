import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '@shared/process-runner';

const baseOptions = {
  cwd: process.cwd(),
  timeoutMs: 5_000,
  maxStdoutBytes: 1024,
  maxStderrBytes: 1024,
};

describe('bounded process runner', () => {
  it('captures stdout and stderr from a normal exit', async () => {
    const result = await runBoundedProcess(process.execPath, [
      '-e',
      "process.stdout.write('normal-out'); process.stderr.write('normal-error')",
    ], baseOptions);

    expect(result).toMatchObject({ code: 0, signal: null, stdout: 'normal-out', stderr: 'normal-error' });
    expect(result.pid).toEqual(expect.any(Number));
    expect(result.pid).toBeGreaterThan(0);
  });

  it('returns bounded output and the numeric code for a nonzero exit', async () => {
    const result = await runBoundedProcess(process.execPath, [
      '-e',
      "process.stdout.write('partial'); process.stderr.write('failed'); process.exit(7)",
    ], baseOptions);

    expect(result).toMatchObject({ code: 7, stdout: 'partial', stderr: 'failed' });
  });

  it('terminates and rejects a process that exceeds its timeout', async () => {
    await expect(
      runBoundedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        ...baseOptions,
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
  });

  it('terminates the parent and grandchild when its AbortSignal fires', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-process-abort-tree-'));
    const pidFile = join(dir, 'pids.json');
    let pids: ProcessTreePids | null = null;
    const controller = new AbortController();
    let pending: ReturnType<typeof runBoundedProcess> | null = null;

    try {
      pending = runBoundedProcess(process.execPath, ['-e', processTreeScript(pidFile)], {
        ...baseOptions,
        timeoutMs: 30_000,
        signal: controller.signal,
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
      pids = await waitForPidFile(pidFile, 3_000);
      expect(pids.grandchildParent).toBe(pids.parent);
      expect(isProcessAlive(pids.parent)).toBe(true);
      expect(isProcessAlive(pids.grandchild)).toBe(true);

      const reason = new Error('cancel requested');
      controller.abort(reason);

      expect(controller.signal.reason).toBe(reason);
      await rejection;
      await waitForProcessesToStop([pids.parent, pids.grandchild], 5_000);
      expect(isProcessAlive(pids.parent)).toBe(false);
      expect(isProcessAlive(pids.grandchild)).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort(new Error('test cleanup'));
      await settleWithin(pending, 6_000);
      if (pids) {
        killIfAlive(pids.grandchild);
        killIfAlive(pids.parent);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it.each([
    ['stdout', "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)", 'PROCESS_STDOUT_LIMIT'],
    ['stderr', "process.stderr.write('x'.repeat(4096)); setInterval(() => {}, 1000)", 'PROCESS_STDERR_LIMIT'],
  ])('terminates when %s exceeds its byte limit', async (_stream, script, code) => {
    await expect(
      runBoundedProcess(process.execPath, ['-e', script], {
        ...baseOptions,
        timeoutMs: 2_000,
        maxStdoutBytes: 64,
        maxStderrBytes: 64,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('terminates both a child and its grandchild', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-process-tree-'));
    const pidFile = join(dir, 'pids.json');
    let pids: ProcessTreePids | null = null;

    try {
      await expect(
        runBoundedProcess(process.execPath, ['-e', processTreeScript(pidFile)], {
          ...baseOptions,
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
      pids = await waitForPidFile(pidFile, 3_000);

      await waitForProcessesToStop([pids.parent, pids.grandchild], 5_000);
      expect(isProcessAlive(pids.parent)).toBe(false);
      expect(isProcessAlive(pids.grandchild)).toBe(false);
    } finally {
      if (pids) {
        killIfAlive(pids.parent);
        killIfAlive(pids.grandchild);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
});

interface ProcessTreePids {
  parent: number;
  grandchild: number;
  grandchildParent: number;
}

function processTreeScript(pidFile: string): string {
  const grandchildScript = [
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.ppid, grandchild: process.pid, grandchildParent: process.ppid }))`,
    'setInterval(() => {}, 1000)',
  ].join(';');
  return [
    "const { spawn } = require('node:child_process')",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore', windowsHide: true })`,
    'setInterval(() => {}, 1000)',
  ].join(';');
}

async function waitForPidFile(pidFile: string, timeoutMs: number): Promise<ProcessTreePids> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value: unknown = JSON.parse(await readFile(pidFile, 'utf8'));
      if (isProcessTreePids(value)) return value;
      throw new Error('Process tree published invalid PIDs.');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Process tree did not publish its PIDs.');
}

function isProcessTreePids(value: unknown): value is ProcessTreePids {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ProcessTreePids>;
  return isPid(item.parent)
    && isPid(item.grandchild)
    && isPid(item.grandchildParent)
    && item.parent !== item.grandchild;
}

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

async function settleWithin(pending: Promise<unknown> | null, timeoutMs: number): Promise<void> {
  if (!pending) return;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForProcessesToStop(pids: number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(isProcessAlive)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already stopped.
  }
}
