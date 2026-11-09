import { AppError } from './app-error';

const denyUntilConfigured = async (): Promise<void> => {
  throw new AppError('LICENSE_NOT_READY', '授权服务尚未就绪，无法调用生成服务。');
};
let authorize: () => Promise<void> = denyUntilConfigured;

// Installed by the desktop main process; providers check again when dispatching queued work.
export function setGenerationAuthorization(check: () => Promise<void>): void { authorize = check; }
export function resetGenerationAuthorization(): void { authorize = denyUntilConfigured; }
export function requireGenerationAuthorization(): Promise<void> { return authorize(); }

// Identity-only evidence: only the pre-dispatch guard can mark an error as never sent.
const notSubmitted = new WeakSet<object>();
export function markGenerationNotSubmitted(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  notSubmitted.add(failure);
  return failure;
}
export function wasGenerationNotSubmitted(error: unknown): boolean {
  return error instanceof Error && notSubmitted.has(error);
}
