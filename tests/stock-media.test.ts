import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  STOCK_MEDIA_LICENSES,
  classifyStockMediaHttpFailure,
  configuredStockMediaProviders,
  filterStockMediaItems,
  isAllowedStockMediaUrl,
  orientationFromRatio,
  parsePexelsPhotoSearch,
  parsePexelsVideoSearch,
  parsePixabayImageSearch,
  parsePixabayVideoSearch,
  selectBestRendition,
  stockMediaRetryAfterMs,
  type StockMediaRendition,
} from '../src/shared/stock-media';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/stock-media/${name}`, import.meta.url), 'utf8'));
}

describe('stock media parsers (documented JSON shapes; 【未核实】 against the live APIs)', () => {
  it('parses Pexels videos, drops insecure/off-host/broken files and picks a 1080p landscape rendition', async () => {
    const result = parsePexelsVideoSearch(await fixture('pexels-videos-search.json'), { target: { ratio: 16 / 9 } });
    expect(result).toMatchObject({ provider: 'pexels', kind: 'video', page: 1, perPage: 2, totalResults: 3, hasMore: true });
    expect(result.items.map(item => item.id)).toEqual(['1448735', '2499611']);
    const [forest] = result.items;
    expect(forest).toMatchObject({
      provider: 'pexels', kind: 'video', author: 'Ruvim Miksanskiy', authorUrl: 'https://www.pexels.com/@digitech',
      sourceUrl: 'https://www.pexels.com/video/video-of-forest-1448735/', durationSeconds: 32, width: 3840, height: 2160,
      downloadUrl: 'https://videos.pexels.com/video-files/1448735/1448735-hd_1920_1080_25fps.mp4',
      license: STOCK_MEDIA_LICENSES.pexels, fingerprint: 'pexels:video:1448735',
    });
    expect(forest.previewUrl).toMatch(/^https:\/\/images\.pexels\.com\//u);
    expect(forest.renditions.map(item => item.url).some(url => url.startsWith('http:'))).toBe(false);
    expect(forest.renditions).toHaveLength(3);
  });

  it('parses Pexels photos with documented crops', async () => {
    const result = parsePexelsPhotoSearch(await fixture('pexels-photos-search.json'), { target: { ratio: 9 / 16, shortSide: 800 } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'photo', author: 'Lukas Rodriguez', width: 3066, height: 3968 });
    expect(result.items[0].downloadUrl).toContain('h=1200&w=800');
  });

  it('parses Pixabay videos, ignoring empty renditions and hits without any file', async () => {
    const result = parsePixabayVideoSearch(await fixture('pixabay-videos-search.json'), { page: 1, perPage: 3 });
    expect(result).toMatchObject({ provider: 'pixabay', totalResults: 500, hasMore: true });
    expect(result.items.map(item => item.id)).toEqual(['125', '126']);
    expect(result.items[0]).toMatchObject({
      author: 'Coverr-Free-Footage', authorUrl: 'https://pixabay.com/users/Coverr-Free-Footage-1281706/',
      sourceUrl: 'https://pixabay.com/videos/id-125/', width: 3840, height: 2160, durationSeconds: 12,
      downloadUrl: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4',
      previewUrl: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg',
      license: STOCK_MEDIA_LICENSES.pixabay,
    });
    expect(result.items[1].renditions).toHaveLength(1);
  });

  it('parses Pixabay images', async () => {
    const result = parsePixabayImageSearch(await fixture('pixabay-images-search.json'));
    expect(result.items[0]).toMatchObject({ kind: 'photo', author: 'Josch13', width: 4000, height: 2250, downloadUrl: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg' });
  });

  it('rejects an unrecognisable envelope with a typed error instead of crashing', () => {
    expect(() => parsePexelsVideoSearch({ error: 'nope' })).toThrow(expect.objectContaining({ code: 'STOCK_MEDIA_RESPONSE_INVALID' }));
    expect(() => parsePixabayVideoSearch('<html>')).toThrow(expect.objectContaining({ code: 'STOCK_MEDIA_RESPONSE_INVALID' }));
  });
});

describe('stock media error classification', () => {
  it('maps auth, rate limit and Pixabay key errors', () => {
    expect(classifyStockMediaHttpFailure({ provider: 'pexels', status: 401 })).toMatchObject({ code: 'STOCK_MEDIA_KEY_INVALID', retryable: false });
    expect(classifyStockMediaHttpFailure({ provider: 'pixabay', status: 403 })).toMatchObject({ code: 'STOCK_MEDIA_KEY_INVALID' });
    expect(classifyStockMediaHttpFailure({ provider: 'pixabay', status: 400, body: '[ERROR 400] "key" is required' })).toMatchObject({ code: 'STOCK_MEDIA_KEY_INVALID' });
    expect(classifyStockMediaHttpFailure({ provider: 'pixabay', status: 400, body: '[ERROR 400] "per_page" is out of range' }).code).toBe('STOCK_MEDIA_REQUEST_FAILED');
    const limited = classifyStockMediaHttpFailure({ provider: 'pexels', status: 429, headers: { 'Retry-After': '12' } });
    expect(limited).toMatchObject({ code: 'STOCK_MEDIA_RATE_LIMITED', retryable: true, retryAfterMs: 12_000 });
    expect(limited.message).toContain('12 秒');
    expect(classifyStockMediaHttpFailure({ provider: 'pexels', status: 503 })).toMatchObject({ code: 'STOCK_MEDIA_REQUEST_FAILED', retryable: true });
    expect(classifyStockMediaHttpFailure({ provider: 'pexels', status: 404, phase: 'download' }).code).toBe('STOCK_MEDIA_LINK_EXPIRED');
  });

  it('reads X-Ratelimit-Reset per provider semantics', () => {
    const now = 1_800_000_000_000;
    expect(stockMediaRetryAfterMs('pexels', { 'x-ratelimit-reset': String(now / 1000 + 30) }, now)).toBe(30_000);
    expect(stockMediaRetryAfterMs('pixabay', new Headers({ 'X-RateLimit-Reset': '45' }), now)).toBe(45_000);
    expect(stockMediaRetryAfterMs('pixabay', {}, now)).toBeUndefined();
  });
});

describe('stock media rendition selection and filters', () => {
  const renditions: StockMediaRendition[] = [
    { url: 'https://v/sd.mp4', width: 640, height: 360, fileType: 'video/mp4' },
    { url: 'https://v/hd.mp4', width: 1920, height: 1080, fileType: 'video/mp4' },
    { url: 'https://v/uhd.mp4', width: 3840, height: 2160, fileType: 'video/mp4' },
    { url: 'https://v/8k.mp4', width: 7680, height: 4320, fileType: 'video/mp4' },
    { url: 'https://v/portrait.mp4', width: 1080, height: 1920, fileType: 'video/mp4' },
    { url: 'https://v/hd.webm', width: 1920, height: 1080, fileType: 'video/webm' },
  ];
  it('matches the target ratio first, then the closest resolution, preferring mp4 and avoiding oversize', () => {
    expect(selectBestRendition(renditions, { ratio: 16 / 9 })?.url).toBe('https://v/hd.mp4');
    expect(selectBestRendition(renditions, { ratio: 9 / 16 })?.url).toBe('https://v/portrait.mp4');
    expect(selectBestRendition(renditions, { ratio: 16 / 9, shortSide: 2160 })?.url).toBe('https://v/uhd.mp4');
    expect(selectBestRendition(renditions.slice(3, 4), { ratio: 16 / 9 })?.url).toBe('https://v/8k.mp4');
    expect(selectBestRendition([], { ratio: 1 })).toBeUndefined();
  });

  it('derives orientation from the task ratio and filters duration/orientation client-side', async () => {
    expect(orientationFromRatio('16:9')).toBe('landscape');
    expect(orientationFromRatio('9:16')).toBe('portrait');
    expect(orientationFromRatio('1:1')).toBe('square');
    expect(orientationFromRatio(undefined)).toBe('landscape');
    const parsed = parsePixabayVideoSearch(await fixture('pixabay-videos-search.json'));
    expect(filterStockMediaItems(parsed.items, { orientation: 'landscape', maxDurationSeconds: 60 }).map(item => item.id)).toEqual(['125']);
    expect(filterStockMediaItems(parsed.items, { orientation: 'portrait' })).toEqual([]);
  });

  it('allows only https provider hosts (loopback http only when explicitly enabled for tests)', () => {
    const policy = { hosts: ['pexels.com'] };
    expect(isAllowedStockMediaUrl('https://videos.pexels.com/a.mp4', policy)).toBe(true);
    expect(isAllowedStockMediaUrl('http://videos.pexels.com/a.mp4', policy)).toBe(false);
    expect(isAllowedStockMediaUrl('https://pexels.com.evil.example/a.mp4', policy)).toBe(false);
    expect(isAllowedStockMediaUrl('https://user:pw@videos.pexels.com/a.mp4', policy)).toBe(false);
    expect(isAllowedStockMediaUrl('http://127.0.0.1:9/a.mp4', policy)).toBe(false);
    expect(isAllowedStockMediaUrl('http://127.0.0.1:9/a.mp4', { ...policy, allowLoopbackHttp: true })).toBe(true);
  });

  it('derives configured providers from public secret status only', () => {
    expect(configuredStockMediaProviders(undefined)).toEqual([]);
    expect(configuredStockMediaProviders({ 'stockMedia/pixabay/apiKey': true, 'stockMedia/pexels/apiKey': false })).toEqual(['pixabay']);
  });
});
