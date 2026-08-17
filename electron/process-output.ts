export interface ProcessOutputLike {
  on: (event: 'error', listener: (error: Error) => void) => unknown;
}

export function isBrokenPipeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EPIPE';
}

export function guardProcessOutput(stream: ProcessOutputLike | null | undefined): void {
  if (!stream) return;
  stream.on('error', (error) => {
    if (isBrokenPipeError(error)) return;
    throw error;
  });
}
