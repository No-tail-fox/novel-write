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

  it('fetches linked web pages and uses page body text as source content', async () => {
    const fetched: string[] = [];
    const researcher = createAiSourceResearcher(defaultConfig, async (url) => {
      fetched.push(String(url));
      if (String(url).includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?>
          <rss><channel>
            <item><title>Article A</title><link>https://example.test/article-a</link><description>Short snippet only.</description></item>
          </channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      return new Response(
        `<html><head><title>Article A</title></head><body><nav>menu</nav><article><p>Full article paragraph one about the comeback.</p><p>Full article paragraph two with useful details.</p></article><script>ignored()</script></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    });

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'Wu Zetian comeback' }));

    expect(fetched).toEqual(['https://cn.bing.com/search?q=Wu%20Zetian%20comeback&format=rss', 'https://example.test/article-a']);
    expect(context.sections[0]).toMatchObject({
      source: 'web',
      title: 'Article A',
      url: 'https://example.test/article-a',
      snippet: 'Short snippet only.',
    });
    expect(context.sections[0].content).toContain('Full article paragraph one');
    expect(context.sections[0].content).not.toContain('ignored()');
  });

  it('uses user-selected web sources without searching again during task execution', async () => {
    let called = false;
    const researcher = createAiSourceResearcher(defaultConfig, async () => {
      called = true;
      return new Response('');
    });

    const context = await researcher(
      makeTask({
        aiSources: ['web', 'builtin-knowledge'],
        selectedSources: [{ source: 'web', title: 'Chosen article', url: 'https://example.test/chosen', content: 'Selected body text for generation.' }],
      }),
    );

    expect(called).toBe(false);
    expect(context.sections[0]).toMatchObject({ title: 'Chosen article', content: 'Selected body text for generation.' });
    expect(context.sections.map((section) => section.source)).toEqual(['web', 'builtin-knowledge']);
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
    selectedSources: [],
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
