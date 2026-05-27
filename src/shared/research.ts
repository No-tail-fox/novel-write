import type { JsonLlm } from './llm-provider';
import type { AiSourceContext, AiSourceSection, AppConfig, ResearchCopyComposeInput, ResearchCopyComposeResult, Task } from './types';

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
      if (task.selectedSources.length > 0) {
        context.sections.push(...task.selectedSources.filter((section) => section.source === 'web'));
      } else {
        try {
          const webSections = await searchWebSources(query, fetchImpl);
          if (webSections.length === 0) {
            context.warnings.push('web search returned no usable results.');
          } else {
            context.sections.push(...webSections);
          }
        } catch (error) {
          context.warnings.push(`web search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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

export async function searchWebSources(query: string, fetchImpl: FetchLike = fetch): Promise<AiSourceSection[]> {
  const rssItems = await searchBingRss(query, fetchImpl);
  const sections: AiSourceSection[] = [];
  for (const item of rssItems.slice(0, 10)) {
    let content = item.content;
    if (item.url) {
      const pageText = await fetchPageText(item.url, fetchImpl).catch(() => '');
      if (pageText) {
        content = pageText;
      }
    }
    sections.push({ ...item, snippet: item.content, content });
  }
  return sections;
}

async function searchBingRss(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const urls = [
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, 8000, 'application/rss+xml,text/xml,*/*');
      if (!response.ok) {
        lastError = new Error(`Bing RSS returned ${response.status}`);
        continue;
      }
      const xml = await response.text();
      return extractRssItems(xml).slice(0, 10).map((item) => ({ source: 'web', ...item }));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Bing RSS request failed'));
}

export async function composeCopyFromSources(runJson: JsonLlm, input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> {
  const selectedSources = input.selectedSources.filter((source) => source.source === 'web').slice(0, 10);
  if (selectedSources.length === 0) {
    throw new Error('Please select at least one web source before generating copy.');
  }

  const sourceBlocks = selectedSources
    .map((source, index) => {
      const url = source.url ? `\nURL: ${source.url}` : '';
      const text = compactText(source.content || source.snippet || '').slice(0, 2600);
      return `${index + 1}. ${source.title}${url}\n${text}`;
    })
    .join('\n\n');

  const result = await runJson<{ copy?: string; inputText?: string; materialText?: string }>({
    step: 0,
    name: 'research-copy',
    messages: [
      {
        role: 'system',
        content:
          'You are a short-video script researcher. Use only the selected web page material and the user requirements to write a concise Chinese source copy. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Keyword: ${input.keyword}`,
          input.extraRequirements ? `Extra requirements: ${input.extraRequirements}` : '',
          'Selected web page material:',
          sourceBlocks,
          'Output JSON shape: {"copy":"一段可继续进入短视频流水线的中文文案素材，保留事实依据，避免编造网页中没有的信息。"}',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const copy = (result.json.copy || result.json.inputText || result.json.materialText || '').trim();
  if (!copy) {
    throw new Error('LLM did not return copy text for selected sources.');
  }
  return { copy, raw: result.raw, requestId: result.requestId };
}

async function fetchPageText(url: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchWithTimeout(fetchImpl, url, 8000, 'text/html,application/xhtml+xml,text/plain,*/*');
  if (!response.ok) return '';
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) return '';
  const body = await response.text();
  const text = contentType.includes('text/plain') ? body : extractReadableText(body);
  return compactText(text).slice(0, 3000);
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
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

function extractReadableText(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const article = stripped.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? stripped.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? stripped;
  return cleanXml(article);
}

function compactText(input: string): string {
  return decodeEntities(input)
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
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
