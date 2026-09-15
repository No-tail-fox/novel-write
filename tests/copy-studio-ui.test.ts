import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('copy studio UI', () => {
  it('exposes the full sourced multi-round copy workflow and video handoff', async () => {
    const page = await readFile(new URL('../src/features/copy-studio/CopyStudioPage.tsx', import.meta.url), 'utf8');
    for (const text of ['来源搜索', '搜索渠道', '根据', '条来源生成初稿', '文案精修', '本轮修改要求', '按要求精修一轮', '增加赛道特色', '版本记录', '特色赛道', '保留预审', '跳过预审', '回传并继续视频制作']) expect(page).toContain(text);
    expect(page).toContain('api.searchWebSources');
    expect(page).toContain('api.composeResearchCopy');
    expect(page).toContain("navigate('new-task')");
    expect(page).toContain('useBuiltinKnowledge: false');
    expect(page).not.toMatch(/<(button|input|select|textarea)\b/u);
  });

  it('uses a stable three-pane desktop layout with compact fallback', async () => {
    const css = await readFile(new URL('../src/features/copy-studio/copy-studio.css', import.meta.url), 'utf8');
    expect(css).toContain('grid-template-columns: minmax(250px, 300px) minmax(420px, 1fr) minmax(260px, 320px)');
    expect(css).toContain('@media (max-width: 1120px)');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('letter-spacing: 0');
  });
});
