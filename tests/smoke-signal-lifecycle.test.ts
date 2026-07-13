import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  formatSmokeError,
  installSmokeSignalLifecycle,
  runSmokeWithTempRoot,
  setSmokeFailureExitCode,
  type SmokeSignal,
} from '../scripts/smoke-signal-lifecycle';

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
  readonly pid = 4242;
  readonly killCalls: Array<{ pid: number; signal: SmokeSignal; listeners: number[] }> = [];

  kill(pid: number, signal: SmokeSignal): boolean {
    this.killCalls.push({
      pid,
      signal,
      listeners: [this.listenerCount('SIGINT'), this.listenerCount('SIGTERM')],
    });
    return true;
  }
}

describe('smoke signal lifecycle', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('aborts gracefully on the first %s and preserves its exit semantics', (signal, exitCode) => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const forceDefault = vi.fn();
    const lifecycle = installSmokeSignalLifecycle({ processLike, controller, forceDefault });

    processLike.emit(signal);

    expect(lifecycle.firstSignal).toBe(signal);
    expect(processLike.exitCode).toBe(exitCode);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(Error);
    expect(controller.signal.reason).toMatchObject({
      name: 'AbortError',
      signal,
      exitCode,
    });
    expect(forceDefault).not.toHaveBeenCalled();
  });

  it('keeps the first signal and reason after disposal', () => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const lifecycle = installSmokeSignalLifecycle({
      processLike,
      controller,
      forceDefault: vi.fn(),
    });

    processLike.emit('SIGINT');
    const reason = controller.signal.reason;
    lifecycle.dispose();
    lifecycle.dispose();

    expect(lifecycle.firstSignal).toBe('SIGINT');
    expect(controller.signal.reason).toBe(reason);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it.each([
    ['SIGINT', 'SIGINT'],
    ['SIGINT', 'SIGTERM'],
  ] as const)('removes handlers before forcing a second %s -> %s signal and preserves the first reason', (first, second) => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const forcedSignals: SmokeSignal[] = [];
    const lifecycle = installSmokeSignalLifecycle({
      processLike,
      controller,
      forceDefault: (signal) => {
        expect(processLike.listenerCount('SIGINT')).toBe(0);
        expect(processLike.listenerCount('SIGTERM')).toBe(0);
        forcedSignals.push(signal);
      },
    });

    processLike.emit(first);
    const firstReason = controller.signal.reason;
    processLike.emit(second);
    lifecycle.dispose();

    expect(lifecycle.firstSignal).toBe(first);
    expect(controller.signal.reason).toBe(firstReason);
    expect(forcedSignals).toEqual([second]);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('uses the process default force behavior when none is injected', () => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const lifecycle = installSmokeSignalLifecycle({ processLike, controller });

    processLike.emit('SIGTERM');
    processLike.emit('SIGTERM');

    expect(lifecycle.firstSignal).toBe('SIGTERM');
    expect(processLike.killCalls).toEqual([{
      pid: processLike.pid,
      signal: 'SIGTERM',
      listeners: [0, 0],
    }]);
  });

  it('disposes idempotently and ignores later signals', () => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const forceDefault = vi.fn();
    const lifecycle = installSmokeSignalLifecycle({ processLike, controller, forceDefault });

    lifecycle.dispose();
    lifecycle.dispose();
    processLike.emit('SIGINT');

    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
    expect(controller.signal.aborted).toBe(false);
    expect(lifecycle.firstSignal).toBeNull();
    expect(forceDefault).not.toHaveBeenCalled();
  });

  it('installs handlers before temporary setup, forwards one shared signal, and cleans up after success', async () => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const order: string[] = [];

    const result = await runSmokeWithTempRoot({
      processLike,
      controller,
      forceDefault: vi.fn(),
      createTempRoot: async (signal) => {
        expect(processLike.listenerCount('SIGINT')).toBe(1);
        expect(processLike.listenerCount('SIGTERM')).toBe(1);
        expect(signal).toBe(controller.signal);
        order.push('create');
        return 'temp-root';
      },
      run: async ({ tempRoot, signal }) => {
        expect(tempRoot).toBe('temp-root');
        expect(signal).toBe(controller.signal);
        order.push('run');
        return 'ok';
      },
      cleanup: async (tempRoot) => {
        expect(tempRoot).toBe('temp-root');
        order.push('cleanup');
      },
    });

    expect(result).toBe('ok');
    expect(order).toEqual(['create', 'run', 'cleanup']);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('disposes handlers when temporary root creation fails without cleaning an unknown path', async () => {
    const processLike = new FakeProcess();
    const cleanup = vi.fn();

    await expect(runSmokeWithTempRoot({
      processLike,
      createTempRoot: async () => {
        throw new Error('mkdtemp failed');
      },
      run: vi.fn(),
      cleanup,
    })).rejects.toThrow('mkdtemp failed');

    expect(cleanup).not.toHaveBeenCalled();
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('does not start execution when a signal arrives during temporary root creation', async () => {
    const processLike = new FakeProcess();
    const controller = new AbortController();
    const run = vi.fn();
    const cleanup = vi.fn(async () => undefined);

    const error: unknown = await runSmokeWithTempRoot({
      processLike,
      controller,
      createTempRoot: async () => {
        processLike.emit('SIGINT');
        return 'temp-root';
      },
      run,
      cleanup,
    }).then(() => null, (reason: unknown) => reason);

    expect(error).toBe(controller.signal.reason);
    expect(run).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('temp-root');
    expect(processLike.exitCode).toBe(130);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it.each(['mkdir', 'electron'] as const)('cleans the temporary root when %s execution fails', async (stage) => {
    const processLike = new FakeProcess();
    const cleanup = vi.fn(async () => undefined);

    await expect(runSmokeWithTempRoot({
      processLike,
      createTempRoot: async () => 'temp-root',
      run: async () => {
        throw new Error(`${stage} failed`);
      },
      cleanup,
    })).rejects.toThrow(`${stage} failed`);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith('temp-root');
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('disposes handlers even when temporary cleanup fails', async () => {
    const processLike = new FakeProcess();

    await expect(runSmokeWithTempRoot({
      processLike,
      createTempRoot: async () => 'temp-root',
      run: async () => 'ok',
      cleanup: async () => {
        throw new Error('cleanup failed');
      },
    })).rejects.toThrow('cleanup failed');

    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('preserves the primary execution error when cleanup also fails', async () => {
    const processLike = new FakeProcess();
    const executionError = new Error('electron failed');
    const cleanupError = new Error('cleanup failed');

    const error: unknown = await runSmokeWithTempRoot({
      processLike,
      createTempRoot: async () => 'temp-root',
      run: async () => {
        throw executionError;
      },
      cleanup: async () => {
        throw cleanupError;
      },
    }).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([executionError, cleanupError]);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
  });

  it('formats every underlying error when execution and cleanup both fail', () => {
    const executionError = new Error('electron failed');
    const cleanupError = new Error('cleanup failed');
    const error = new AggregateError(
      [executionError, cleanupError],
      'Smoke execution and temporary cleanup both failed.',
    );

    const formatted = formatSmokeError(error);

    expect(formatted).toContain('Smoke execution and temporary cleanup both failed.');
    expect(formatted).toContain('electron failed');
    expect(formatted).toContain('cleanup failed');
  });

  it.each([130, 143])('does not overwrite signal exit code %s with a generic failure', (exitCode) => {
    const processLike = new FakeProcess();
    processLike.exitCode = exitCode;

    setSmokeFailureExitCode(processLike);

    expect(processLike.exitCode).toBe(exitCode);
  });

  it.each([undefined, null, 0] as const)('sets a generic failure for a non-signal exit code %s', (exitCode) => {
    const processLike = new FakeProcess();
    processLike.exitCode = exitCode;

    setSmokeFailureExitCode(processLike);

    expect(processLike.exitCode).toBe(1);
  });
});
