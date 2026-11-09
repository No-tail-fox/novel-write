import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREATIVE_STYLES, LEMO_LIBRARY_STYLES, OPUSCAR98_STYLES, LEMO_UPSTREAM_STYLE_REVISION, creativeStyle, creativeStyleSupportsMode, isOpuscar98StyleId } from '../src/shared/creative-animation/styles';
import { creativeStylePoster } from '../src/shared/creative-animation/posters';
import { creativeStyleSample } from '../src/shared/creative-animation/samples';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { loadOpuscar98StyleReference } from '../electron/lemo-opuscar98';
import { preflightLemoUpstream } from '../electron/lemo-upstream-production';
import { stepLemoUpstreamAgent, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { taskCreationTarget } from '../src/features/tasks/TaskCreationTypePicker';
import { clearCreativeRoute, creativeRouteMode, peekCreativeRoute } from '../src/features/editorial-collage/creative-route';

const upstreamRoot = resolve('vendor/lemo-upstream');
const library = { upstreamRoot, threeRoot: resolve('node_modules/three') };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('Lemo route catalog: 66 library styles + OPUSCAR 98', () => {
  it('lists every complete library style of the pinned snapshot and keeps the 59 template styles adapted', () => {
    expect(LEMO_UPSTREAM_STYLE_REVISION).toBe(LEMO_UPSTREAM_REVISION);
    expect(LEMO_LIBRARY_STYLES).toHaveLength(66);
    expect(new Set(LEMO_LIBRARY_STYLES.map(s => s.slug)).size).toBe(66);
    for (const slug of ['chalkboard', 'circuit-board', 'desktop-flythrough', 'isometric-picture-book', 'memphis-diorama', 'printed-long-take', 'transit-map']) {
      expect(LEMO_LIBRARY_STYLES.find(s => s.slug === slug), slug).toMatchObject({ readiness: 'collected', adapter: undefined, family: 'library' });
      expect(existsSync(join(upstreamRoot, 'styles', slug, 'STYLE.md'))).toBe(true);
    }
    expect(CREATIVE_STYLES).toHaveLength(59);
    expect(CREATIVE_STYLES.every(s => s.adapter)).toBe(true);
    expect(CREATIVE_STYLES.every(s => LEMO_LIBRARY_STYLES.some(l => l.slug === s.slug))).toBe(true);
  });

  it('ingests the 98 light styles from the hash-verified vendored source with valid agent style ids', async () => {
    const manifest = JSON.parse(await readFile(join(upstreamRoot, 'storydream-upstream.json'), 'utf8')) as { files: Array<{ path: string; sha256: string }> };
    const bytes = await readFile(join(upstreamRoot, 'styleboard/opuscar98_styles.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files.find(f => f.path === 'styleboard/opuscar98_styles.json')!.sha256);
    const book = JSON.parse(bytes.toString('utf8')) as { films: Array<{ no: number; style_zh: string; zh: string; render: string }> };
    expect(OPUSCAR98_STYLES).toHaveLength(98);
    for (const film of book.films) {
      const style = creativeStyle(`o98-${String(film.no).padStart(2, '0')}`)!;
      expect(style).toMatchObject({ family: 'opuscar98', cn: film.style_zh, adapter: undefined });
      expect(style.opuscar98).toMatchObject({ zh: film.zh, render: film.render });
      expect(style.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(isOpuscar98StyleId(style.slug)).toBe(true);
      expect(creativeStylePoster(style.slug), style.slug).toBeTruthy();
      expect(creativeStyleSample(style.slug)?.video).toMatch(/opuscar98\.mp4#t=\d+\.\d{3},\d+\.\d{3}$/);
    }
    expect(OPUSCAR98_STYLES.filter(s => s.opuscar98?.render === '3D')).toHaveLength(17);
    for (const style of LEMO_LIBRARY_STYLES) expect(creativeStylePoster(style.slug), style.slug).toBeTruthy();
    expect(isOpuscar98StyleId('halftone-dossier')).toBe(false);
  });

  it('allows light and unadapted styles only on the Lemo route', () => {
    expect(creativeStyleSupportsMode(creativeStyle('o98-01'), 'ai-code')).toBe(true);
    expect(creativeStyleSupportsMode(creativeStyle('o98-01'), 'template')).toBe(false);
    expect(creativeStyleSupportsMode(creativeStyle('transit-map'), 'template')).toBe(false);
    expect(creativeStyleSupportsMode(creativeStyle('halftone-dossier'), 'template')).toBe(true);
    expect(creativeStyleSupportsMode(creativeStyle('no-such-style'), 'ai-code')).toBe(false);
  });
});

describe('OPUSCAR 98 generation path', () => {
  it('builds a verified style reference and preflights MY-STYLES.md instead of a library STYLE.md', async () => {
    const reference = await loadOpuscar98StyleReference(upstreamRoot, 'o98-01');
    const film = (JSON.parse(await readFile(join(upstreamRoot, 'styleboard/opuscar98_styles.json'), 'utf8')) as { films: Array<{ no: number; prompt_en: string; prompt_zh: string }> }).films.find(f => f.no === 1)!;
    expect(reference).toContain(film.prompt_en);
    expect(reference).toContain(film.prompt_zh);
    expect(reference).toContain('do NOT reuse');
    await expect(loadOpuscar98StyleReference(upstreamRoot, 'o98-99')).rejects.toThrow('LEMO_O98_STYLE');
    await expect(loadOpuscar98StyleReference(upstreamRoot, 'brick-toy')).rejects.toThrow('LEMO_O98_STYLE');
    await expect(preflightLemoUpstream(library, 'o98-42')).resolves.toBeUndefined();
    await expect(preflightLemoUpstream(library, 'transit-map')).resolves.toBeUndefined();
  });

  it('tells the agent to write its own STYLE.md via MY-STYLES.md for light styles only', async () => {
    const prompts: string[] = [];
    const run = async (styleId: string, styleReference?: string) => {
      const root = await mkdtemp(join(tmpdir(), 'lemo-o98-')); roots.push(root);
      const model = vi.fn(async (request: { messages: Array<{ role: string; content: string }> }) => {
        prompts.push(request.messages[0].content);
        const text = '```json\n{"tool":"list_files","scope":"library","path":"styles"}\n```';
        return { text, raw: text, requestId: 'mock', finishReason: 'stop' };
      });
      const options = { root, upstreamRoot, model, review: vi.fn(),
        context: { runId: 'o98-run', styleId, brief: '原创中文短片。', durationSeconds: 3, width: 1920, height: 1080, ...(styleReference ? { styleReference } : {}) } } as unknown as LemoAgentOptions;
      await stepLemoUpstreamAgent(options);
    };
    await run('o98-07', await loadOpuscar98StyleReference(upstreamRoot, 'o98-07'));
    await run('brick-toy');
    expect(prompts[0]).toContain('MY-STYLES.md');
    expect(prompts[0]).toContain('<opuscar98-style id="o98-07"');
    expect(prompts[0]).not.toContain('styles/o98-07/STYLE.md');
    expect(prompts[1]).toContain('styles/brick-toy/STYLE.md');
    expect(prompts[1]).not.toContain('MY-STYLES.md');
  });
});

describe('three code-animation entries', () => {
  it('routes 创意动画 to Lemo and 模板动画 to the template route on the shared creative page', () => {
    expect(taskCreationTarget('vox')).toBe('editorial-collage');
    expect(creativeRouteMode(peekCreativeRoute())).toBe('ai-code');
    expect(taskCreationTarget('template-animation')).toBe('editorial-collage');
    expect(creativeRouteMode(peekCreativeRoute())).toBe('template');
    clearCreativeRoute();
    expect(creativeRouteMode(peekCreativeRoute())).toBe('ai-code');
    expect(taskCreationTarget('html-video')).toBe('html-video');
  });
});
