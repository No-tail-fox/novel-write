import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { executeTaskOutputs } from '../src/shared/task-output-runner';
import { buildShortVideoComposition, prepareShortVideoInput } from '../src/shared/short-video-render';
import type { TaskDeliverables } from '../src/shared/types';
import type { WriteJianyingDraftInput } from '../src/shared/draft';
import { getTemplate } from '../src/shared/templates';

function fixture(): WriteJianyingDraftInput {
  return { workDir: 'C:/fixture', draftRootDir: 'C:/drafts', title: '同步测试', cover: { title: '同步测试', subtitle: ['两个输出'], summary: '同一时间轴', tags: [], comments: [] }, ratio: '9:16', template: getTemplate('default-portrait-9-16'),
    scenes: [{ id: 1, cap: '第一句话。', descPrompt: '', durationMs: 1000 }, { id: 2, cap: '第二句话。', descPrompt: '', durationMs: 1000 }], imagePrompts: [], reviewedText: '', rewrittenCopy: '',
    generatedImages: [{ sceneId: 1, path: 'C:/fixture/one.png' }, { sceneId: 2, path: 'C:/fixture/two.png' }], narrationAudio: [{ sceneId: 1, path: 'C:/fixture/one.wav' }, { sceneId: 2, path: 'C:/fixture/two.wav' }], bgm: null };
}

describe('independent output delivery', () => {
  it.each([['mp4'], ['jianying-draft'], ['mp4', 'jianying-draft']])('only produces requested targets %j', async (...targets) => {
    const produce = vi.fn(async target => `/output/${target}`);
    await executeTaskOutputs({ targets, fingerprint: 'a', produce, onUpdate: async () => {}, verify: async () => true });
    expect(produce.mock.calls.map(([target]) => target)).toEqual(targets);
  });
  it('preserves the successful output and retries only the failed one', async () => {
    let saved: TaskDeliverables = {};
    const produce = vi.fn(async target => { if (target === 'mp4') throw new Error('encoder failed'); return '/draft'; });
    const onUpdate = async (value: TaskDeliverables) => { saved = structuredClone(value); };
    await expect(executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint: 'a', produce, onUpdate, verify: async () => true })).rejects.toThrow('encoder failed');
    expect(saved['jianying-draft']?.status).toBe('completed');
    expect(saved.mp4?.status).toBe('failed');
    const retry = vi.fn(async () => '/film.mp4');
    await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], previous: saved, fingerprint: 'a', produce: retry, onUpdate, verify: async () => true });
    expect(retry).toHaveBeenCalledExactlyOnceWith('mp4');
    expect(saved.mp4?.status).toBe('completed');
  });
  it('invalidates successful artifacts when inputs change or files disappear', async () => {
    const previous: TaskDeliverables = { mp4: { status: 'completed', path: '/old.mp4', fingerprint: 'old', updatedAt: '' } };
    const produce = vi.fn(async () => '/new.mp4');
    await executeTaskOutputs({ targets: ['mp4'], previous, fingerprint: 'new', produce, onUpdate: async () => {}, verify: async () => true });
    expect(produce).toHaveBeenCalledTimes(1);
    const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await executeTaskOutputs({ targets: ['mp4'], previous, fingerprint: 'old', produce, onUpdate: async () => {}, verify });
    expect(produce).toHaveBeenCalledTimes(2);
  });
  it('does not start the next output after cancellation', async () => {
    const controller = new AbortController();
    const produce = vi.fn(async () => { controller.abort(); return '/film.mp4'; });
    await expect(executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint: 'a', signal: controller.signal, produce, onUpdate: async () => {}, verify: async () => true })).rejects.toThrow();
    expect(produce).toHaveBeenCalledTimes(1);
  });
});

describe('short-video shared timeline', () => {
  it('uses actual audio duration without truncating long narration', async () => {
    const prepared = await prepareShortVideoInput(fixture(), async path => path.includes('one') ? 1700 : 800);
    expect(prepared.scenes.map(s => s.durationMs)).toEqual([1700, 1000]);
    expect(prepared.subtitles?.cues.at(-1)?.endMs).toBe(2700);
    const composition = buildShortVideoComposition(prepared);
    expect(composition.totalDurationS).toBe(2.7);
    expect(composition.scenes[0].audioClips?.[0].durationMs).toBe(1700);
  });
  it('keeps multi-speaker clips in turn order and adds a real cover scene', async () => {
    const input = fixture();
    input.narrationAudio.push({ sceneId: 1, path: 'C:/fixture/three.wav', turnIndex: 1 });
    input.narrationAudio[0].turnIndex = 2;
    input.coverPage = { imagePath: 'C:/fixture/cover.png', text: '标题', durationMs: 900 };
    const prepared = await prepareShortVideoInput(input, async () => 800);
    const result = buildShortVideoComposition(prepared);
    expect(result.scenes).toHaveLength(3);
    expect(result.totalDurationS).toBe(3.5);
    expect(result.scenes[1].audioClips?.map(c => c.startMs)).toEqual([0, 800]);
    expect(result.scenes[1].audioClips?.[0].path).toContain('three');
    expect(result.scenes[0].html).toContain('标题');
  });
  it('slows short source video to the scene clock without freezing or applying image motion', async () => {
    const input = fixture();
    input.generatedVideos = [{ sceneId: 1, path: 'C:/fixture/short.mp4', source: 'local-upload', originalName: 'short', durationMs: 2000, width: 720, height: 1280, trimStartMs: 500, fit: 'cover', muted: true }];
    input.template!.image.motion = 'zoom_in';
    input.template!.image.mediaScale = 2;
    const result = buildShortVideoComposition(await prepareShortVideoInput(input, async () => 3000));
    const media = { tagName: 'VIDEO', duration: 2, currentTime: 0, readyState: 4, style: { transform: '' } };
    const window = { __tl: undefined as unknown as { seek: (seconds: number) => void } };
    runInNewContext(result.scenes[0].html!.match(/<script>([\s\S]*?)<\/script>/)![1], {
      window, document: { getElementById: (id: string) => id === 'media' ? media : null, fonts: { ready: Promise.resolve() }, images: [] },
    });
    await Promise.resolve();
    window.__tl.seek(1.5);
    expect(media.currentTime).toBeCloseTo(1.25);
    expect(media.style.transform).toBe('translate(0%,0%) scale(1)');
    window.__tl.seek(2.7);
    expect(media.currentTime).toBeCloseTo(1.85);
  });
  it('escapes script-like authored text and includes video trim', async () => {
    const input = fixture(); input.cover.title = '</script><script>alert(1)</script>';
    input.generatedVideos = [{ sceneId: 1, path: 'C:/fixture/clip.mp4', source: 'local-upload', originalName: 'clip', durationMs: 5000, width: 720, height: 1280, trimStartMs: 1000, fit: 'cover', muted: true }];
    const result = buildShortVideoComposition(await prepareShortVideoInput(input, async () => 1000));
    expect(result.scenes[0].html).not.toContain(input.cover.title);
    expect(result.scenes[0].html).toContain('trim=1000');
    expect(result.scenes[0].html).toContain('<video');
  });
});

describe('short-video template and audio parity', () => {
  it('keeps a global BGM fade envelope across cover, scenes and source loops', async () => {
    const input = fixture();
    input.coverPage = { imagePath: 'C:/fixture/cover.png', text: 'Cover', durationMs: 500 };
    input.bgm = { id: 'test-bgm', title: 'Loop', path: 'C:/fixture/bgm.wav', durationMs: 600, volume: .3 };
    input.template!.audio.bgmFadeInMs = 1500;
    input.template!.audio.bgmFadeOutMs = 1000;
    const result = buildShortVideoComposition(await prepareShortVideoInput(input, async path => path.includes('bgm') ? 600 : 1000));
    let offset = 0;
    for (const scene of result.scenes) {
      for (const clip of scene.audioClips!.filter(c => c.trackType === 'music')) {
        expect(clip.fadeEnvelope).toEqual({ offsetMs: offset + clip.startMs, durationMs: 2500, fadeInMs: 1500, fadeOutMs: 1000 });
      }
      offset += scene.durationMs;
    }
  });
  it('renders the configured caption background and translucent stroke', async () => {
    const input = fixture();
    input.template!.caption.background = { color: '#123456', alpha: .4, roundRadius: .5 };
    input.template!.caption.border = { color: '#000000', alpha: .5, width: 10 };
    const result = buildShortVideoComposition(await prepareShortVideoInput(input, async () => 1000));
    expect(result.scenes[0].html).toContain('background-color:rgba(18,52,86,0.4)');
    expect(result.scenes[0].html).toContain('border-radius:12px');
    expect(result.scenes[0].html).toContain('rgba(0,0,0,0.5)');
  });
  it('orders legacy unnumbered narration after explicit turns like the draft writer', async () => {
    const input = fixture();
    input.narrationAudio.push({ sceneId: 1, path: 'C:/fixture/first.wav', turnIndex: 1 });
    const result = buildShortVideoComposition(await prepareShortVideoInput(input, async () => 1000));
    expect(result.scenes[0].audioClips?.filter(c => c.trackType === 'narration').map(c => c.path)).toEqual(['C:/fixture/first.wav', 'C:/fixture/one.wav']);
  });
});
