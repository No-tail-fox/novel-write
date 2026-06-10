import { describe, expect, it } from 'vitest';
import { buildViralMediaWorkerEnv } from '@shared/viral-download';

describe('viral downloader process', () => {
  it('forces UTF-8 for Python worker output on Windows pipes', () => {
    expect(buildViralMediaWorkerEnv({ PATH: 'C:/Windows/System32' })).toMatchObject({
      PATH: 'C:/Windows/System32',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    });
  });
});
