import type { AiSourceContext, AiSourceSection, AppConfig, Task } from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type AiSourceResearcher = (task: Task) => Promise<AiSourceContext>;

export function createAiSourceResearcher(config: AppConfig, fetchImpl: FetchLike = fetch): AiSourceResearcher {
  return async (task) => {
    const query = (task.aiKeyword || task.inputText || '').trim();
    const context: AiSourceContext = { query, sections: [], warnings: [] };
    if (task.mode !== 'ai' || task.aiSources.length === 0 || !query) {
      return context;
    }

    const sources = new Set(task.aiSources);
    if (sources.has('web')) {
      try {
        const webSections = await searchBingRss(query, fetchImpl);
        if (webSections.length === 0) {
          context.warnings.push('web search returned no usable results.');
        } else {
          context.sections.push(...webSections);
        }
      } catch (error) {
        context.warnings.push(`web search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (sources.has('builtin-knowledge')) {
      context.sections.push(buildBuiltinKnowledgeSection(task));
    }
    if (sources.has('ima')) {
      if (config.ima.apiKey && (config.ima.kbId || config.ima.kbName)) {
        context.sections.push({
          source: 'ima',
          title: config.ima.kbName || config.ima.kbId,
          content: `IMA knowledge base is configured. Use it as a preferred private reference for "${query}".`,
        });
      } else {
        context.warnings.push('IMA knowledge base is not configured; skipped.');
      }
    }

    return context;
  };
}

export function formatAiSourceContext(task: Pick<Task, 'aiKeyword' | 'aiSources' | 'extraRequirements'>, context: AiSourceContext): string {
  const lines = [
    `AI keyword: ${context.query || task.aiKeyword}`,
    task.extraRequirements ? `Extra requirements: ${task.extraRequirements}` : '',
    `Sources: ${task.aiSources.join(', ') || 'none'}`,
  ].filter(Boolean);

  if (context.sections.length > 0) {
    lines.push(
      'Reference materials:',
      ...context.sections.map((section, index) => {
        const url = section.url ? `\nURL: ${section.url}` : '';
        return `${index + 1}. [${section.source}] ${section.title}${url}\n${section.content}`;
      }),
    );
  }
  if (context.warnings.length > 0) {
    lines.push('Warnings:', ...context.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join('\n\n');
}

async function searchBingRss(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  const response = await fetchWithTimeout(fetchImpl, url, 8000);
  if (!response.ok) {
    throw new Error(`Bing RSS returned ${response.status}`);
  }
  const xml = await response.text();
  return extractRssItems(xml).slice(0, 5).map((item) => ({ source: 'web', ...item }));
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml,text/xml,*/*',
        'User-Agent': 'Mozilla/5.0 StoryboundReplica/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractRssItems(xml: string): Array<Omit<AiSourceSection, 'source'>> {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map(([item]) => ({
      title: cleanXml(extractTag(item, 'title')),
      url: cleanXml(extractTag(item, 'link')),
      content: cleanXml(extractTag(item, 'description')),
    }))
    .filter((item) => item.title && item.content);
}

function extractTag(input: string, tag: string): string {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ?? '';
}

function cleanXml(input: string): string {
  return decodeEntities(input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')).trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildBuiltinKnowledgeSection(task: Task): AiSourceSection {
  const pov = task.narrativePov === 'first-person' ? 'first-person narration' : task.narrativePov === 'third-person' ? 'third-person narration' : 'the original narrative point of view';
  return {
    source: 'builtin-knowledge',
    title: '本地知识补全',
    content: [
      `Track: ${task.track}.`,
      `Style: ${task.style}; ratio: ${task.ratio}.`,
      `Rewrite intensity: ${task.rewriteIntensity}; use ${pov}.`,
      task.keepPromotion ? 'Keep product or promotion intent if present.' : 'Do not add promotion unless source material requires it.',
      task.extraRequirements ? `Creator requirements: ${task.extraRequirements}` : '',
    ].filter(Boolean).join(' '),
  };
}
