import { describe, expect, it } from 'vitest';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { voxProductionSettings } from '../src/shared/vox-production';

describe('new native creative animation defaults', () => {
  it('chooses a topic-neutral material style instead of dossier styling', () => {
    expect(resolveCreativeStyle('auto', 'paper-explainer')?.slug).toBe('brick-toy');
    expect(resolveCreativeStyle('auto', 'data-map')?.slug).toBe('dataviz');
    expect(resolveCreativeStyle('auto', 'archival-story')?.slug).toBe('archive-lighttable');
  });
  it('keeps Lemo-only policies opt-in on ordinary legacy/template settings', () => {
    expect(voxProductionSettings().codeVideo).toBeUndefined();
    expect(newCodeVideoPolicy().targetDurationSeconds).toBe(60);
  });
});
