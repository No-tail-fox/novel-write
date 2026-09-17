import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Agent Search settings UI', () => {
  it('exposes the default-on backend switch and the actual fallback order', async () => {
    const [settings, config] = await Promise.all([
      readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/config.ts', import.meta.url), 'utf8'),
    ]);

    expect(settings).toContain("'Agent Search · SearXNG · Tavily · 兼容源'");
    expect(settings).toContain('checked={draft.webSearch.agentSearchEnabled}');
    expect(settings).toContain('agentSearchEnabled: data.checked');
    expect(settings).toContain('label="启用 Agent Search 聚合搜索"');
    expect(settings).toContain('搜索顺序：Agent Search → SearXNG → Tavily Keyless → 兼容搜索源');
    expect(config).toMatch(/webSearch:\s*\{[\s\S]*?agentSearchEnabled:\s*true/u);
  });
});
