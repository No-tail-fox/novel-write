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

  it('terminates and rejects a process when its AbortSignal fires', async () => {
    const controller = new AbortController();
    const pending = runBoundedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      ...baseOptions,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('cancel requested')), 100);

    await expect(pending).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
  });

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
    let pids: { parent: number; grandchild: number } | null = null;
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })",
      `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }))`,
      'setInterval(() => {}, 1000)',
    ].join(';');

    try {
      await expect(
        runBoundedProcess(process.execPath, ['-e', script], {
          ...baseOptions,
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
      pids = JSON.parse(await readFile(pidFile, 'utf8')) as { parent: number; grandchild: number };

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
