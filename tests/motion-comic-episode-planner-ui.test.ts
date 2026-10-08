import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('motion comic episode planner UI contract', () => {
  it('keeps AI episode planning inside the existing three-step create flow', async () => {
    const [flow, page, css] = await Promise.all([
      source('src/features/motion-comic/MotionComicCreateFlow.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/styles/features/motion-comic.css'),
    ]);

    expect(flow).toContain("{ value: 'ai-story', label: 'AI 剧情分集' }");
    expect(flow).toContain("splitEvidence?.strategy === 'ai-story'");
    expect(flow).toContain('生成 AI 分集');
    expect(flow).toContain('episode.startUnitId && episode.endUnitId');
    expect(flow).toContain('readOnly={aiSplit}');
    expect(flow).toContain('拆分依据');
    expect(flow).toContain('尾钩与承接');
    expect(page).toContain('api.planMotionComicEpisodes');
    expect(page).toContain('splitEvidence,');
    expect(page).toContain("createSplitEvidence?.strategy !== 'ai-story'");
    expect(page).toContain('episodePlanningRequestRef.current');
    expect(css).toContain('.motion-comic-ai-split-settings');
    expect(css).toContain('.motion-comic-source-boundary-evidence');
    for (const rawControl of ['<button', '<input', '<textarea', '<select']) expect(flow).not.toContain(rawControl);
  });

  it('routes previews through trusted IPC without writing a project', async () => {
    const [api, ipc, preload, main] = await Promise.all([
      source('src/shared/storydream-api.ts'),
      source('src/shared/ipc-contract.ts'),
      source('electron/preload.ts'),
      source('electron/main.ts'),
    ]);

    expect(api).toContain("'motion-comic:plan-episodes'");
    expect(api).toContain('planMotionComicEpisodes: (input: MotionComicEpisodePlanInput)');
    expect(ipc).toContain("'motion-comic:plan-episodes': motionComicEpisodePlanInputSchema");
    expect(preload).toContain("invokeTrusted('motion-comic:plan-episodes', input)");
    const handlerStart = main.indexOf("trustedHandle('motion-comic:plan-episodes'");
    const handlerEnd = main.indexOf("trustedHandle('motion-comic:save'", handlerStart);
    const handler = main.slice(handlerStart, handlerEnd);
    expect(handler).toContain('generateMotionComicEpisodePlan');
    expect(handler).toContain('createConfiguredJsonLlm(runtimeConfig.llm)');
    expect(handler).not.toContain('getDb()');
    expect(handler).not.toContain('saveMotionComicTask');
  });
});
