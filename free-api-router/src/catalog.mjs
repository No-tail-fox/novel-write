import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_PATH, DATA_DIR } from './config.mjs';

export const SOURCES = {
  githubSites: 'https://raw.githubusercontent.com/panxunying/ai-coding-welfare/main/data/sites.json',
  githubLive: 'https://raw.githubusercontent.com/panxunying/ai-coding-welfare/main/data/live.json',
  baipiaoCharity: 'https://baipiao.org/charity/',
};

const SOURCE_TIMEOUT_MS = 20000;

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x3D;/gi, '=')
    .replace(/&#x3F;/gi, '?')
    .replace(/&#x26;/gi, '&');
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeHtml(match[1] ?? match[2] ?? '') : '';
}

function parseAnchorLinks(fragment) {
  return [...fragment.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      label: stripHtml(match[2]),
      url: decodeHtml(attr(match[1], 'href')),
    }))
    .filter((link) => link.url && /^https?:\/\//i.test(link.url));
}

export function parseBaiPiaoCharity(html) {
  const starts = [...html.matchAll(/<[^>]*data-card[^>]*>/gi)];
  const entries = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index].index;
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length;
    const card = html.slice(start, end);
    const tag = starts[index][0];
    const detailMatch = card.match(/<a[^>]*class="cname"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const summaryMatch = card.match(/<p[^>]*class="csum"[^>]*>([\s\S]*?)<\/p>/i);
    if (!detailMatch) continue;
    const detailPath = decodeHtml(detailMatch[1]);
    const status = /data-status="([^"]+)"/i.exec(tag)?.[1] || (/运营中/.test(card) ? 'online' : 'unknown');
    const links = parseAnchorLinks(card).filter((link) => !link.url.includes('baipiao.org/charity/'));
    entries.push({
      id: `baipiao:${attr(tag, 'data-entry-id') || detailPath.split('/').filter(Boolean).at(-1)}`,
      source: 'baipiao',
      name: stripHtml(detailMatch[2]),
      detailUrl: new URL(detailPath, SOURCES.baipiaoCharity).href,
      summary: summaryMatch ? stripHtml(summaryMatch[1]) : '',
      status,
      links,
      callable: false,
      note: '发现目录入口；调用前需在服务商后台自行注册并创建 API Key。',
    });
  }
  return entries;
}

function githubCatalog(sites, live) {
  const liveById = new Map((live.sites || []).map((site) => [site.id, site]));
  return (sites.sites || []).map((site) => {
    const snapshot = liveById.get(site.id) || {};
    const models = (snapshot.models || []).map((model) => ({
      name: model.name,
      protocols: model.protocols || [],
    }));
    return {
      id: `github:${site.id}`,
      source: 'github',
      sourceId: site.id,
      name: site.name,
      summary: site.subtitle,
      homeUrl: site.homeUrl,
      signupUrl: site.signupUrl,
      docsUrl: site.docsUrl,
      endpoints: site.endpoints || {},
      mirrors: site.mirrors || [],
      tags: site.tags || [],
      models,
      defaults: snapshot.defaults || {},
      online: snapshot.online ?? null,
      latencyMs: snapshot.latencyMs ?? null,
      checkedAt: snapshot.checkedAt || null,
      stale: Boolean(snapshot.dataStale),
      callable: Boolean(site.endpoints?.openai || site.endpoints?.anthropic),
      caveats: site.caveats || [],
    };
  });
}

export async function buildCatalog() {
  const [sites, live, baipiaoHtml] = await Promise.all([
    fetchJson(SOURCES.githubSites),
    fetchJson(SOURCES.githubLive),
    fetchText(SOURCES.baipiaoCharity),
  ]);
  const callable = githubCatalog(sites, live);
  const directory = parseBaiPiaoCharity(baipiaoHtml);
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    sources: [
      { id: 'github-sites', url: SOURCES.githubSites, fetchedAt: generatedAt },
      { id: 'github-live', url: SOURCES.githubLive, fetchedAt: generatedAt },
      { id: 'baipiao-charity', url: SOURCES.baipiaoCharity, fetchedAt: generatedAt },
    ],
    providers: callable,
    directory,
  };
}

export async function syncCatalog() {
  const catalog = await buildCatalog();
  await mkdir(DATA_DIR, { recursive: true });
  const tempPath = path.join(DATA_DIR, `.tmp-catalog-${process.pid}.json`);
  await writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(tempPath, CATALOG_PATH);
  return catalog;
}

export function findProvider(catalog, sourceId) {
  return catalog?.providers?.find((provider) => provider.sourceId === sourceId || provider.id === sourceId) || null;
}
