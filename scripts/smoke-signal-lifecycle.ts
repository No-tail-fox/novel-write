export type SmokeSignal = 'SIGINT' | 'SIGTERM';

export interface SmokeSignalProcess {
  readonly pid?: number;
  exitCode?: number | string | null;
  on(signal: SmokeSignal, listener: () => void): unknown;
  removeListener(signal: SmokeSignal, listener: () => void): unknown;
  kill?(pid: number, signal: SmokeSignal): unknown;
}

export interface SmokeSignalLifecycle {
  readonly firstSignal: SmokeSignal | null;
  dispose(): void;
}

export interface SmokeTempRootContext {
  tempRoot: string;
  signal: AbortSignal;
}

export interface SmokeTempRootLifecycleInput<T> {
  processLike?: SmokeSignalProcess;
  controller?: AbortController;
  forceDefault?: (signal: SmokeSignal) => void;
  createTempRoot(signal: AbortSignal): Promise<string>;
  run(context: SmokeTempRootContext): Promise<T>;
  cleanup(tempRoot: string): Promise<void>;
}

class SmokeSignalAbortError extends Error {
  readonly signal: SmokeSignal;
  readonly exitCode: number;

  constructor(signal: SmokeSignal, exitCode: number) {
    super(`Smoke process interrupted by ${signal}.`);
    this.name = 'AbortError';
    this.signal = signal;
    this.exitCode = exitCode;
  }
}

export function installSmokeSignalLifecycle(input: {
  processLike: SmokeSignalProcess;
  controller: AbortController;
  forceDefault?: (signal: SmokeSignal) => void;
}): SmokeSignalLifecycle {
  const { processLike, controller } = input;
  const forceDefault = input.forceDefault ?? ((signal: SmokeSignal) => {
    const pid = processLike.pid;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || typeof processLike.kill !== 'function') {
      throw new Error('Smoke signal process cannot restore default signal handling.');
    }
    processLike.kill(pid, signal);
  });
  let firstSignal: SmokeSignal | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    processLike.removeListener('SIGINT', onSigint);
    processLike.removeListener('SIGTERM', onSigterm);
  };
  const handleSignal = (signal: SmokeSignal) => {
    if (firstSignal !== null) {
      dispose();
      forceDefault(signal);
      return;
    }
    firstSignal = signal;
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    processLike.exitCode = exitCode;
    controller.abort(new SmokeSignalAbortError(signal, exitCode));
  };
  const onSigint = () => handleSignal('SIGINT');
  const onSigterm = () => handleSignal('SIGTERM');

  processLike.on('SIGINT', onSigint);
  processLike.on('SIGTERM', onSigterm);

  return {
    get firstSignal() {
      return firstSignal;
    },
    dispose,
  };
}

export async function runSmokeWithTempRoot<T>(input: SmokeTempRootLifecycleInput<T>): Promise<T> {
  const processLike = input.processLike ?? process;
  const controller = input.controller ?? new AbortController();
  const lifecycle = installSmokeSignalLifecycle({
    processLike,
    controller,
    forceDefault: input.forceDefault,
  });
  let tempRoot: string | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    tempRoot = await input.createTempRoot(controller.signal);
    controller.signal.throwIfAborted();
    return await input.run({ tempRoot, signal: controller.signal });
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    throw error;
  } finally {
    try {
      if (tempRoot !== undefined) await input.cleanup(tempRoot);
    } catch (cleanupError) {
      if (hasPrimaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          'Smoke execution and temporary cleanup both failed.',
        );
      }
      throw cleanupError;
    } finally {
      lifecycle.dispose();
    }
  }
}

export function setSmokeFailureExitCode(
  processLike: Pick<SmokeSignalProcess, 'exitCode'> = process,
): void {
  if (processLike.exitCode === undefined || processLike.exitCode === null || processLike.exitCode === 0) {
    processLike.exitCode = 1;
  }
}

export function formatSmokeError(error: unknown): string {
  return formatSmokeErrorPart(error, new Set<object>());
}

function formatSmokeErrorPart(error: unknown, seen: Set<object>): string {
  if (!error || typeof error !== 'object') return String(error);
  if (seen.has(error)) return '[Circular error]';
  seen.add(error);

  if (error instanceof AggregateError) {
    const summary = error.stack || error.message;
    const details = error.errors.map((item, index) => (
      `Error ${index + 1}:\n${formatSmokeErrorPart(item, seen)}`
    ));
    return [summary, ...details].join('\n');
  }
  if (error instanceof Error) {
    const summary = error.stack || error.message;
    return error.cause === undefined
      ? summary
      : `${summary}\nCaused by:\n${formatSmokeErrorPart(error.cause, seen)}`;
  }
  return String(error);
}
