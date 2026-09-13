import { describe, expect, it } from 'vitest';
import { readWorkspaceDraft } from '../src/app/workspace-draft';

describe('recoverable workspace drafts', () => {
  const defaults = { title: '', count: 4, enabled: false };

  it('restores UTF-8 text and only the declared non-secret fields', () => {
    const stored = JSON.stringify({ version: 1, values: { title: '未完成的文案', count: 8, enabled: true, apiKey: 'ignored' } });
    expect(readWorkspaceDraft(stored, defaults)).toEqual({ title: '未完成的文案', count: 8, enabled: true });
  });

  it('preserves defaults for malformed, old, and incompatible values', () => {
    for (const raw of [null, '{', 'null', '{"version":2,"values":{"title":"old"}}']) {
      expect(readWorkspaceDraft(raw, defaults)).toEqual(defaults);
    }
    expect(readWorkspaceDraft('{"version":1,"values":{"title":42,"count":"8","enabled":null}}', defaults)).toEqual(defaults);
  });

  it('does not accept non-finite numbers or mutate defaults', () => {
    const result = readWorkspaceDraft('{"version":1,"values":{"count":1e999,"title":"draft"}}', defaults);
    expect(result).toEqual({ title: 'draft', count: 4, enabled: false });
    expect(defaults.title).toBe('');
  });
});
