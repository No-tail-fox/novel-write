import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { configTargetStatus, validateConfigTarget } from '@shared/config-utils';

describe('config validation utilities', () => {
  it('validates Jianying draft paths through the injected filesystem check', () => {
    const config = {
      ...defaultConfig,
      jianying: {
        ...defaultConfig.jianying,
        draftPath: 'I:/missing-draft-root-for-test',
      },
    };

    const result = validateConfigTarget('jianying', config, { pathExists: () => false });

    expect(result.status).toBe('fail');
    expect(result.endpoint).toBe('I:/missing-draft-root-for-test');
    expect(configTargetStatus('jianying', config, { pathExists: () => true })).toBe('pass');
  });
});
