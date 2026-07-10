import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface BoundedProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface BoundedProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export type BoundedProcessErrorCode =
  | 'PROCESS_ABORTED'
  | 'PROCESS_START_FAILED'
  | 'PROCESS_STDERR_LIMIT'
  | 'PROCESS_STDOUT_LIMIT'
  | 'PROCESS_TIMEOUT';

export class BoundedProcessError extends Error {
  constructor(
    public readonly code: BoundedProcessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BoundedProcessError';
  }
}

const processTerminationGraceMs = 300;
const taskkillTimeoutMs = 5_000;

export function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  validateProcessOptions(command, args, options);
  if (options.signal?.aborted) {
    return Promise.reject(processError('PROCESS_ABORTED', 'Process execution was cancelled.'));
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(startFailure(error));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let closeResult: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let terminalError: BoundedProcessError | null = null;
    let spawnError: BoundedProcessError | null = null;
    let termination: Promise<void> | null = null;
    let timeout: NodeJS.Timeout | undefined;

    const removeExternalTriggers = () => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    };

    const settleAfterClose = async () => {
      if (settled || !closeResult) return;
      removeExternalTriggers();
      if (termination) await termination;
      if (settled) return;
      settled = true;
      if (spawnError) {
        reject(spawnError);
        return;
      }
      if (terminalError) {
        reject(terminalError);
        return;
      }
      resolve({
        ...closeResult,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
      });
    };

    const terminateWith = (error: BoundedProcessError) => {
      if (terminalError || spawnError || closeResult) return;
      terminalError = error;
      removeExternalTriggers();
      termination = terminateProcessTree(child).catch(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process already exited or the platform rejected the fallback signal.
        }
      });
    };

    const capture = (
      chunk: Buffer | string,
      chunks: Buffer[],
      currentBytes: number,
      maxBytes: number,
      code: 'PROCESS_STDOUT_LIMIT' | 'PROCESS_STDERR_LIMIT',
    ): number => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxBytes - currentBytes);
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      const nextBytes = currentBytes + buffer.byteLength;
      if (nextBytes > maxBytes) {
        terminateWith(processError(code, code === 'PROCESS_STDOUT_LIMIT'
          ? 'Process stdout exceeded its byte limit.'
          : 'Process stderr exceeded its byte limit.'));
      }
      return Math.min(nextBytes, maxBytes);
    };

    const abort = () => terminateWith(processError('PROCESS_ABORTED', 'Process execution was cancelled.'));

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBytes = capture(chunk, stdoutChunks, stdoutBytes, options.maxStdoutBytes, 'PROCESS_STDOUT_LIMIT');
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBytes = capture(chunk, stderrChunks, stderrBytes, options.maxStderrBytes, 'PROCESS_STDERR_LIMIT');
    });
    child.once('error', (error) => {
      spawnError = startFailure(error);
      removeExternalTriggers();
    });
    child.once('close', (code, signal) => {
      closeResult = { code, signal };
      void settleAfterClose();
    });

    timeout = setTimeout(() => {
      terminateWith(processError('PROCESS_TIMEOUT', 'Process execution exceeded its time limit.'));
    }, options.timeoutMs);
    timeout.unref?.();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export function redactProcessOutput(value: unknown): string {
  return String(value ?? '')
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/((?:^|[\r\n])\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1[REDACTED]');
}

function validateProcessOptions(command: string, args: readonly string[], options: BoundedProcessOptions): void {
  if (!command.trim()) throw new TypeError('Process command is required.');
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('Process arguments must be strings.');
  }
  if (!options.cwd.trim()) throw new TypeError('Process working directory is required.');
  assertPositiveInteger(options.timeoutMs, 'timeoutMs');
  assertNonNegativeInteger(options.maxStdoutBytes, 'maxStdoutBytes');
  assertNonNegativeInteger(options.maxStderrBytes, 'maxStderrBytes');
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await runTaskkill(pid);
    if (isChildRunning(child)) {
      try {
        child.kill('SIGKILL');
      } catch {
        // taskkill may already have reaped the process.
      }
    }
    return;
  }

  signalProcessGroup(pid, 'SIGTERM', child);
  await delay(processTerminationGraceMs);
  if (isProcessGroupAlive(pid) || isChildRunning(child)) signalProcessGroup(pid, 'SIGKILL', child);
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let killer: ChildProcess;
    try {
      killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      resolve();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      try {
        killer.kill('SIGKILL');
      } catch {
        // Ignore taskkill cleanup races.
      }
      finish();
    }, taskkillTimeoutMs);
    timeout.unref?.();
    killer.once('error', finish);
    killer.once('close', finish);
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals, child: ChildProcess): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process tree already exited.
    }
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startFailure(error: unknown): BoundedProcessError {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? ` (${error.code})`
    : '';
  return processError('PROCESS_START_FAILED', `Process could not be started${code}.`);
}

function processError(code: BoundedProcessErrorCode, message: string): BoundedProcessError & NodeJS.ErrnoException {
  return new BoundedProcessError(code, message) as BoundedProcessError & NodeJS.ErrnoException;
}
