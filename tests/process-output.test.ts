import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { guardProcessOutput, isBrokenPipeError } from '../electron/process-output';

describe('Electron process output guard', () => {
  it('recognizes only broken-pipe stream errors', () => {
    expect(isBrokenPipeError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error('closed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(false);
    expect(isBrokenPipeError(null)).toBe(false);
  });

  it('keeps a closed parent output pipe from crashing the main process', () => {
    const stream = new EventEmitter();
    guardProcessOutput(stream);

    expect(() => stream.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow();
  });

  it('does not hide unrelated output failures', () => {
    const stream = new EventEmitter();
    guardProcessOutput(stream);
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    expect(() => stream.emit('error', failure)).toThrow(failure);
  });
});
