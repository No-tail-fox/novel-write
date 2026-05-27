import { describe, expect, it } from 'vitest';
import { createAiSourceResearcher } from '@shared/research';
import { defaultConfig } from '@shared/config';
import type { Task } from '@shared/types';

describe('AI source research', () => {
  it('collects web RSS snippets and built-in knowledge for AI creation', async () => {
    const requests: string[] = [];
    const researcher = createAiSourceResearcher(defaultConfig, async (url) => {
      requests.push(String(url));
      return new Response(
        `<?xml version="1.0"?>
        <rss><channel>
          <item><title>Result A</title><link>https://example.test/a</link><description>First verified snippet.</description></item>
          <item><title>Result B</title><link>https://example.test/b</link><description>Second verified snippet.</description></item>
        </channel></rss>`,
        { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
      );
    });

    const context = await researcher(makeTask({ aiSources: ['web', 'builtin-knowledge'], aiKeyword: 'Wu Zetian comeback' }));

    expect(requests[0]).toContain('bing.com/search');
    expect(context.query).toBe('Wu Zetian comeback');
    expect(context.sections.map((section) => section.title)).toEqual(['Result A', 'Result B', '本地知识补全']);
    expect(context.sections[0]).toMatchObject({ source: 'web', url: 'https://example.test/a', content: 'First verified snippet.' });
    expect(context.warnings).toEqual([]);
  });

  it('keeps AI creation unblocked when web search fails', async () => {
    const researcher = createAiSourceResearcher(defaultConfig, async () => new Response('nope', { status: 503 }));

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'Wu Zetian comeback' }));

    expect(context.sections).toEqual([]);
    expect(context.warnings[0]).toContain('web search failed');
  });

  it('warns when web search returns no parseable results', async () => {
    const researcher = createAiSourceResearcher(defaultConfig, async () => new Response('<rss><channel /></rss>', { status: 200 }));

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'unknown query' }));

    expect(context.sections).toEqual([]);
    expect(context.warnings[0]).toContain('web search returned no usable results');
  });
});

function makeTask(patch: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'task',
    inputText: '',
    status: 'pending',
    currentStep: 0,
    track: 'character-story',
    style: 'photo-real',
    speaker: 'voice',
    ratio: '9:16',
    templateId: 'default-portrait-9-16',
    bgmId: '__builtin__',
    pausePoints: [],
    outputDir: '',
    errorMessage: '',
    createdAt: new Date().toISOString(),
    completedAt: null,
    mode: 'ai',
    aiKeyword: 'Wu Zetian',
    aiSources: ['web'],
    extraRequirements: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'mock',
    ttsSpeed: 1,
    step3PromptSnapshot: '',
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
    ...patch,
  };
}
