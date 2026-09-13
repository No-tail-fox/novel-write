import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { directorCameraStyle, directorLayerStyle } from '../src/features/director-desk/DirectorDeskWorkspace';
import {
  assertDirectorRenderProbe,
  buildDirectorRenderScenes,
  buildDirectorSceneHtml,
  directorCanvasForRatio,
  directorNarrationAlignment,
  evaluateDirectorQuality,
  directorDocumentRenderFingerprint,
  type DirectorRenderResult,
} from '../src/shared/director-render';
import {
  createEditorialCollageDraft,
  rebuildEditorialTimeline,
  editEditorialShotMotion,
  splitEditorialShot,
  mergeEditorialShots,
  type EditorialCollagePipelineData,
} from '../src/shared/editorial-collage';

describe('director render contracts', () => {
  it('measures muted authored narration from the source asset instead of the resolved mix', () => {
    const document = voxRenderDocument('deterministic-layers');
    document.timeline!.audioClips = [{
      id: 'legacy-speech', shotId: 'shot-1', assetVersionId: 'asset-voice', trackType: 'narration',
      startMs: 0, durationMs: 2_000, gainDb: 0, muted: true,
    }];
    const scene = buildDirectorRenderScenes(document)[0];
    expect(scene.audioClips).toEqual([]);
    document.assets.find((asset) => asset.id === 'asset-voice')!.durationMs = 2_100;
    expect(directorNarrationAlignment(document, [scene], undefined, '2026-09-10T00:00:00.000Z')).toMatchObject({
      status: 'passed',
      samples: [{ audioAssetVersionIds: ['asset-voice'], actualDurationMs: 2_100, status: 'aligned' }],
    });
  });
  it('does not repeat beat narration in an explicitly empty shot beside authored cues', () => {
    const document = voxRenderDocument('deterministic-layers');
    document.beats[0].shots.push({ ...structuredClone(document.beats[0].shots[0]), id: 'empty-tail', subtitleCueIds: [] });
    document.beats[0].durationMs *= 2;
    const scenes = buildDirectorRenderScenes(rebuildEditorialTimeline(document));
    expect(scenes[0].caption).not.toBe('');
    expect(scenes[1].caption).toBe('');
    expect(scenes[1].subtitleCues).toEqual([]);
  });
  it.each([false, true])('matches preview and export seek including merged hard cuts: %s', async (merge) => {
    const source = voxRenderDocument('deterministic-layers');
    let edited = editEditorialShotMotion(source, 'shot-1', { kind: 'insert-frame', atMs: 1000 });
    edited = editEditorialShotMotion(edited, 'shot-1', { kind: 'camera-frame', index: 1, patch: { x: 0.6, zoom: 1.3 } });
    edited = editEditorialShotMotion(edited, 'shot-1', { kind: 'layer-frame', layerId: 'layer-bg', index: 1, patch: { scale: 1.2, opacity: 0.7, rotation: 20, y: 0.4 } });
    if (merge) {
      const split = splitEditorialShot(edited, 'shot-1', 1000);
      split.beats[0].shots[1].camera[0].zoom = 1.7;
      edited = mergeEditorialShots(split, split.beats[0].shots[0].id, split.beats[0].shots[1].id);
      edited.beats[0].shots[0].voiceAssetVersionId = source.beats[0].shots[0].voiceAssetVersionId;
      edited = rebuildEditorialTimeline(edited);
    }
    const scene = buildDirectorRenderScenes(edited)[0];
    const html = buildDirectorSceneHtml({ ...scene, modeLabel: 'VOX', layers: scene.layers.map(({ imagePath, ...layer }) => ({ ...layer, imageUrl: `file:///${imagePath}` })) });
    const stage = { style: {} as Record<string, string> };
    const elements = scene.layers.map(() => ({ style: {} as Record<string, string> }));
    const window: { __tl?: { seek: (seconds: number) => Promise<void> }; __ready?: boolean } = {};
    runInNewContext(html.match(/<script nonce="director-render">([\s\S]+)<\/script>/)![1], {
      window,
      document: { getElementById: (id: string) => id === 'scene-video' ? null : stage, querySelectorAll: () => [], querySelector: (selector: string) => elements[Number(selector.match(/"(\d+)"/)![1])] },
      performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    });
    expect(window.__ready).toBe(true);
    for (const atMs of [0, 250, 750, 999, 1000, 1001, 1500, 2000, 500]) {
      await window.__tl!.seek(atMs / 1000);
      const sampledMs = atMs / 1000 * 1000;
      expect(stage.style.transform).toBe(directorCameraStyle(scene.camera, sampledMs, scene.durationMs).transform);
      for (const [index, layer] of scene.layers.entries()) {
        const expected = directorLayerStyle({ ...layer, src: layer.imagePath }, sampledMs);
        expect(elements[index].style.transform).toBe(expected.transform);
        expect(elements[index].style.opacity).toBe(String(expected.opacity));
        expect(elements[index].style.zIndex).toBe(String(expected.zIndex));
      }
    }
  });
  it('exports edited camera/stack data and excludes hidden images from media loading', () => {
    const original = voxRenderDocument('deterministic-layers');
    const moved = editEditorialShotMotion(original, 'shot-1', { kind: 'layer-order', layerId: 'layer-bg', direction: 'up' });
    const camera = editEditorialShotMotion(moved, 'shot-1', { kind: 'camera-frame', index: 1, patch: { zoom: 1.25, x: 0.4 } });
    const hidden = editEditorialShotMotion(camera, 'shot-1', { kind: 'layer-visibility', layerId: 'layer-subject', visible: false });
    // Hidden layers do not require a readable file for final rendering.
    hidden.assets.find((asset) => asset.id === 'asset-subject')!.localPath = undefined;
    const scene = buildDirectorRenderScenes(hidden)[0];
    expect(scene.layers.map((layer) => [layer.id, layer.zIndex])).toEqual([['layer-bg', 1]]);
    expect(scene.camera[1]).toMatchObject({ zoom: 1.25, x: 0.4 });
    const html = buildDirectorSceneHtml({ ...scene, modeLabel: 'VOX', layers: scene.layers.map(({ imagePath, ...layer }) => ({ ...layer, imageUrl: `file:///${imagePath}` })) });
    expect(html).toContain('"zoom":1.25');
    expect(html).not.toContain('subject.png');
    expect(directorDocumentRenderFingerprint(hidden)).not.toBe(directorDocumentRenderFingerprint(original));
    const empty = editEditorialShotMotion(hidden, 'shot-1', { kind: 'layer-visibility', layerId: 'layer-bg', visible: false });
    expect(() => buildDirectorRenderScenes(empty)).toThrow('没有可渲染的本地图层');
  });
  it('uses stable production canvases for every supported project ratio', () => {
    expect(directorCanvasForRatio('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(directorCanvasForRatio('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(directorCanvasForRatio('1:1')).toEqual({ width: 1440, height: 1440 });
    expect(directorCanvasForRatio('4:3')).toEqual({ width: 1440, height: 1080 });
  });

  it('builds a seekable local render scene and escapes project text', () => {
    const html = buildDirectorSceneHtml({
      title: '<script>bad()</script>',
      caption: '城市 & 旧街巷',
      imageUrl: 'file:///I:/director/shot-01.png',
      durationMs: 6000,
      modeLabel: 'VOX',
      index: 1,
    });
    expect(html).toContain('window.__tl');
    expect(html).toContain('window.__ready = true');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('城市 &amp; 旧街巷');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).not.toContain('linear-gradient');
  });

  it('applies persisted layout, motion, and subtitle settings to rendered scenes', () => {
    const html = buildDirectorSceneHtml({
      title: '关键帧',
      caption: '字幕内容',
      imageUrl: 'file:///I:/director/shot-02.png',
      durationMs: 5000,
      modeLabel: 'AI 漫剧',
      index: 2,
      layoutTemplate: '漫画分格 · 角色优先',
      motionPreset: '固定机位',
      subtitleStyle: '简体中文 · 下方黑底',
    });
    expect(html).toContain('frame comic');
    expect(html).toContain('caption backplate');
    expect(html).toContain('data-render-strategy="deterministic-layers"');
    expect(html).toContain('"atMs":5000,"x":0.5,"y":0.5,"zoom":1');
  });

  it('renders documentary titles with the documentary layout and stable safe-area styling', () => {
    const html = buildDirectorSceneHtml({
      title: '一个需要完整保留的纪录片长标题', caption: '字幕内容',
      imageUrl: 'file:///I:/director/shot-03.png', durationMs: 5000,
      modeLabel: 'AI 漫剧', index: 3, layoutTemplate: '纪录片 · 纯画面',
    });
    expect(html).toContain('frame documentary');
    expect(html).toContain('.frame.documentary .title');
    expect(html).toContain('一个需要完整保留的纪录片长标题');
  });

  it('maps persisted VOX layers and camera keyframes without guessing a representative image', () => {
    const document = voxRenderDocument('deterministic-layers');

    expect(buildDirectorRenderScenes(document)).toEqual([{
      id: 'shot-1',
      index: 1,
      title: '城市证据',
      caption: '第一句 第二句',
      subtitleCues: [
        { id: 'cue-1', startMs: 0, endMs: 900, text: '第一句' },
        { id: 'cue-2', startMs: 900, endMs: 2000, text: '第二句' },
      ],
      durationMs: 2_000,
      renderStrategy: 'deterministic-layers',
      layers: [
        {
          id: 'layer-bg',
          label: '背景',
          imagePath: 'C:/managed/background.png',
          zIndex: 0,
          depth: -0.08,
          motion: [
            { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
            { atMs: 2_000, x: 0.5, y: 0.5, scale: 1.04, rotation: 0, opacity: 1 },
          ],
        },
        {
          id: 'layer-subject',
          label: '主体',
          imagePath: 'C:/managed/subject.png',
          zIndex: 10,
          depth: 0.12,
          motion: [{ atMs: 0, x: 0.62, y: 0.5, scale: 0.96, rotation: -2, opacity: 0.92 }],
        },
      ],
      camera: [
        { atMs: 0, x: 0.5, y: 0.5, zoom: 1 },
        { atMs: 2_000, x: 0.48, y: 0.5, zoom: 1.06 },
      ],
      audioPath: 'C:/managed/voice.wav',
      layoutTemplate: '对比拼贴 · 纸张撕裂',
      motionPreset: '轻微视差',
      subtitleStyle: '简体中文 · 下方黑底',
    }]);
  });

  it('uses only the completed authoritative video asset for a living-poster shot', () => {
    const [scene] = buildDirectorRenderScenes(voxRenderDocument('living-poster'));

    expect(scene).toMatchObject({
      renderStrategy: 'living-poster',
      layers: [],
      camera: [],
      videoPath: 'C:/managed/shot-1.mp4',
      videoAssetVersionId: 'asset-video',
      videoJobId: 'job-video',
      audioPath: 'C:/managed/voice.wav',
    });
  });

  it('blocks stale timelines and the unfinished hybrid strategy before capture', () => {
    const document = voxRenderDocument('deterministic-layers');
    const stale: EditorialCollagePipelineData = {
      ...document,
      beats: document.beats.map((beat) => ({
        ...beat,
        shots: beat.shots.map((shot) => ({ ...shot, durationMs: shot.durationMs + 400 })),
      })),
    };
    expect(() => buildDirectorRenderScenes(stale)).toThrow(/VOX 时间线与当前镜头策略或资产版本不一致/u);

    const hybrid = rebuildEditorialTimeline({
      ...document,
      beats: document.beats.map((beat) => ({
        ...beat,
        shots: beat.shots.map((shot) => ({ ...shot, renderStrategy: 'hybrid' as const })),
      })),
    });
    expect(() => buildDirectorRenderScenes(hybrid)).toThrow(/未完成的混合渲染模式/u);
  });

  it('builds living-poster HTML with load gating and awaited video seeking', () => {
    const html = buildDirectorSceneHtml({
      title: '动态海报',
      caption: '权威视频资产',
      videoUrl: 'file:///I:/director/shot-01.mp4',
      renderStrategy: 'living-poster',
      durationMs: 2_000,
      modeLabel: 'VOX',
      index: 1,
    });

    expect(html).toContain('<video id="scene-video"');
    expect(html).toContain('media-src file: data: blob:');
    expect(html).toContain("video.addEventListener('loadeddata', markReady");
    expect(html).toContain('video.currentTime = target');
    expect(html).toContain('return seekVideo(current)');
    expect(html).not.toContain('<img class="scene-layer"');
  });

  it('rejects malformed final media probes and accepts a matching non-black render', () => {
    const expected = { durationMs: 2_000, width: 1920, height: 1080, fps: 24 };
    expect(assertDirectorRenderProbe({
      duration: 2,
      has_audio: true,
      has_video: true,
      has_nonblack_video: true,
      width: 1920,
      height: 1080,
    }, expected)).toBe(2_000);

    expect(() => assertDirectorRenderProbe({ ...validProbe(), has_video: false }, expected)).toThrow(/VIDEO_STREAM_MISSING/u);
    expect(() => assertDirectorRenderProbe({ ...validProbe(), has_audio: false }, expected)).toThrow(/AUDIO_STREAM_MISSING/u);
    expect(() => assertDirectorRenderProbe({ ...validProbe(), width: 1080 }, expected)).toThrow(/SIZE_MISMATCH/u);
    expect(() => assertDirectorRenderProbe({ ...validProbe(), duration: 1 }, expected)).toThrow(/DURATION_MISMATCH/u);
    expect(() => assertDirectorRenderProbe({ ...validProbe(), has_nonblack_video: false }, expected)).toThrow(/BLACK_OUTPUT/u);
  });

  it('records hard quality gates for subtitle bounds, dialogue, media, and stale inputs', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scenes = buildDirectorRenderScenes(document);
    const renderFingerprint = directorDocumentRenderFingerprint(document);
    const result = {
      outputPath: 'I:/work/director-renders/r1/exports/final.mp4',
      durationMs: 2_000,
      sizeBytes: 128,
      width: 1920,
      height: 1080,
      hasAudio: true as const,
      hasVideo: true as const,
      hasNonBlackVideo: true as const,
      audioMeanVolumeDb: -20,
      audioPeakDb: -6,
      audioLufs: -17,
      audioTruePeakDb: -5.8,
      audioQualityStatus: 'ok' as const,
      blackDetectionStatus: 'ok' as const,
      blackIntervalsMs: [],
    };
    const initialChecks = evaluateDirectorQuality(document, scenes, result, renderFingerprint);
    expect(initialChecks.filter(check => check.severity !== 'manual').every((check) => check.status === 'passed')).toBe(true);
    expect(initialChecks.find(check => check.id === 'subtitle-text-safety')?.status).toBe('pending');
    expect(initialChecks.find(check => check.id === 'subtitle-glyphs')?.status).toBe('pending');

    const warningChecks = evaluateDirectorQuality(document, scenes, { ...result, audioPeakDb: 0, audioMeanVolumeDb: -50, blackIntervalsMs: [{ startMs: 0, endMs: 800 }] }, renderFingerprint);
    expect(warningChecks.find((check) => check.id === 'audio-level')).toMatchObject({ status: 'failed', severity: 'warning', recheckScope: { kind: 'audio' } });
    expect(warningChecks.find((check) => check.id === 'black-intervals')).toMatchObject({ status: 'failed', severity: 'warning', recheckScope: { kind: 'media', startMs: 0, endMs: 800 } });
    expect(warningChecks.filter((check) => check.severity === 'blocking').every((check) => check.status === 'passed')).toBe(true);

    for (const status of [undefined, 'unavailable', 'failed'] as const) {
      const unavailable = evaluateDirectorQuality(document, scenes, { ...result, audioQualityStatus: status, blackDetectionStatus: status, audioQualityError: 'audio analysis failed', blackDetectionError: 'video analysis failed' }, renderFingerprint);
      for (const id of ['audio-level', 'black-intervals']) {
        expect(unavailable.find((check) => check.id === id)).toMatchObject({ status: status === 'failed' ? 'failed' : 'pending', severity: 'warning' });
        expect(unavailable.find((check) => check.id === id)?.detail).toBeTruthy();
      }
    }
    for (const value of [undefined, NaN, Infinity]) {
      const incomplete = evaluateDirectorQuality(document, scenes, { ...result, audioMeanVolumeDb: value, blackIntervalsMs: value === undefined ? undefined : [{ startMs: 0, endMs: value }] }, renderFingerprint);
      expect(incomplete.find((check) => check.id === 'audio-level')?.status).toBe('failed');
      expect(incomplete.find((check) => check.id === 'black-intervals')?.status).toBe('failed');
    }

    const broken = structuredClone(scenes);
    broken[0].caption = '';
    broken[0].subtitleCues![0].endMs = 2_500;
    const checks = evaluateDirectorQuality(document, broken, result, 'stale-render');
    expect(checks.find((check) => check.id === 'subtitle-timing')?.status).toBe('failed');
    expect(checks.find((check) => check.id === 'subtitle-timing')?.recheckScope).toMatchObject({ kind: 'subtitle', shotIds: [document.beats[0].shots[0].id], cueIds: [document.beats[0].subtitleCues[0].id] });
    expect(checks.find((check) => check.id === 'dialogue-coverage')?.status).toBe('passed');
    expect(checks.find((check) => check.id === 'render-freshness')?.status).toBe('failed');

    const missing = structuredClone(scenes);
    missing[0].audioPath = '';
    missing[0].caption = '';
    missing[0].subtitleCues = [];
    const missingChecks = evaluateDirectorQuality(document, missing, { ...result, sizeBytes: 0 }, renderFingerprint);
    expect(missingChecks.find((check) => check.id === 'asset-integrity')).toMatchObject({ status: 'failed' });
    expect(missingChecks.find((check) => check.id === 'asset-integrity')?.recheckScope).toMatchObject({ kind: 'asset', shotIds: [document.beats[0].shots[0].id] });
    expect(missingChecks.find((check) => check.id === 'dialogue-coverage')).toMatchObject({ status: 'failed' });
    expect(missingChecks.find((check) => check.id === 'media-output')).toMatchObject({ status: 'failed' });
    expect(missingChecks.find((check) => check.id === 'artifact-location')?.status).toBe('passed');
    const misplaced = evaluateDirectorQuality(document, scenes, { ...result, outputPath: 'I:/old/director-final.mp4' }, renderFingerprint);
    expect(misplaced.find((check) => check.id === 'artifact-location')).toMatchObject({ status: 'failed' });
  });

  it('records subtitle recheck clocks relative to the full timeline', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scenes = buildDirectorRenderScenes(document);
    const second = { ...structuredClone(scenes[0]), id: 'second', index: 2,
      subtitleCues: [{ id: 'bad-clock', text: 'Second', startMs: 300, endMs: scenes[0].durationMs + 100 }] };
    const result: DirectorRenderResult = { outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: scenes[0].durationMs * 2,
      sizeBytes: 128, width: 1920, height: 1080, hasAudio: true, hasVideo: true, hasNonBlackVideo: true };
    const check = evaluateDirectorQuality(document, [scenes[0], second], result, '')
      .find((item) => item.id === 'subtitle-timing');
    expect(check?.recheckScope).toMatchObject({ shotIds: ['second'], cueIds: ['bad-clock'], startMs: scenes[0].durationMs + 300, endMs: scenes[0].durationMs * 2 + 100 });
  });

  it('requires actual layout evidence and reports replacement characters separately', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scenes = buildDirectorRenderScenes(document);
    const renderResult = {
      outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: 2_000, sizeBytes: 128,
      width: 1920, height: 1080, hasAudio: true as const, hasVideo: true as const, hasNonBlackVideo: true as const,
    };
    const longText = '这是一个用于检查字幕安全区的长句子，内容需要在画面底部保持可读并且不能挤出安全区域。'.repeat(3);
    const result = evaluateDirectorQuality(document, [{ ...scenes[0], subtitleCues: [{ id: 'cue-safe', text: longText, startMs: 0, endMs: 1_000 }, { id: 'cue-bad', text: '\uFFFD', startMs: 0, endMs: 1_000 }] }], { ...renderResult, audioQualityStatus: 'ok', audioMeanVolumeDb: -20, audioPeakDb: -6, blackDetectionStatus: 'ok', blackIntervalsMs: [] }, 'fingerprint');
    const check = result.find((item) => item.id === 'subtitle-text-safety');
    expect(check).toMatchObject({ severity: 'manual', status: 'pending' });
    expect(result.find(item => item.id === 'subtitle-glyphs')).toMatchObject({ severity: 'manual', status: 'failed' });
  });

  it('requires complete loudness evidence and distinguishes configured from unexpected silence', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scenes = buildDirectorRenderScenes(document);
    const renderResult = {
      outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: 2_000, sizeBytes: 128,
      width: 1920, height: 1080, hasAudio: true as const, hasVideo: true as const, hasNonBlackVideo: true as const,
      audioQualityStatus: 'ok' as const, audioMeanVolumeDb: -20, audioPeakDb: -6, blackDetectionStatus: 'ok' as const, blackIntervalsMs: [],
    };
    const loud = evaluateDirectorQuality(document, scenes, { ...renderResult, audioLufs: -12, audioTruePeakDb: -0.2 }, directorDocumentRenderFingerprint(document));
    expect(loud.find((check) => check.id === 'audio-level')).toMatchObject({ status: 'failed', severity: 'warning' });
    expect(loud.find((check) => check.id === 'audio-level')?.detail).toMatch(/LUFS/u);
    expect(loud.find((check) => check.id === 'audio-level')?.detail).toMatch(/dBTP/u);

    const evaluate = (metrics: Partial<import('../src/shared/director-render').DirectorRenderResult>, inputScenes = scenes) => evaluateDirectorQuality(document, inputScenes, { ...renderResult, ...metrics }, directorDocumentRenderFingerprint(document)).find((check) => check.id === 'audio-level');
    for (const metrics of [{}, { audioLufs: -17 }, { audioTruePeakDb: -1 }, { audioLufs: NaN, audioTruePeakDb: -1 }, { audioLufs: -17, audioTruePeakDb: Infinity }]) {
      expect(evaluate(metrics)).toMatchObject({ status: 'failed', severity: 'warning', detail: expect.stringContaining('未返回完整指标') });
    }
    for (const audioLufs of [-20, -14]) expect(evaluate({ audioLufs, audioTruePeakDb: -1 })).toMatchObject({ status: 'passed' });
    for (const audioLufs of [-20.1, -13.9]) expect(evaluate({ audioLufs, audioTruePeakDb: -1 })).toMatchObject({ status: 'failed' });
    expect(evaluate({ audioLufs: -17, audioTruePeakDb: -0.9 })).toMatchObject({ status: 'failed' });
    expect(evaluate({ audioMeanVolumeDb: -60, audioPeakDb: -60 })).toMatchObject({ status: 'failed' });
    const silence = { audioMeanVolumeDb: -91, audioPeakDb: -91, audioIsSilent: true };
    expect(evaluate(silence)).toMatchObject({ status: 'failed', severity: 'warning', detail: expect.stringContaining('仍配置了可听音频') });
    expect(evaluate(silence, scenes.map((scene) => ({ ...scene, audioClips: [] })))).toMatchObject({ status: 'passed', detail: expect.stringContaining('与镜头静音设置一致') });
    expect(evaluate({ ...silence, audioLufs: -17, audioTruePeakDb: -1 })).toMatchObject({ status: 'failed' });
    expect(evaluate({ ...silence, audioQualityStatus: 'failed' })).toMatchObject({ status: 'failed' });
  });

  it('allows explicitly silent and background-only shots without declaring missing speech', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scene = buildDirectorRenderScenes(document)[0];
    const result = { outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: 2000, sizeBytes: 128, width: 1920, height: 1080, hasAudio: true as const, hasVideo: true as const, hasNonBlackVideo: true as const };
    for (const audioClips of [[], [{ id: 'ambient', trackType: 'ambience' as const, assetVersionId: 'asset-voice', path: 'C:/managed/voice.wav', startMs: 0, durationMs: 2000 }]]) {
      const checks = evaluateDirectorQuality(document, [{ ...scene, caption: '', subtitleCues: [], audioPath: '', audioClips }], result, directorDocumentRenderFingerprint(document));
      expect(checks.find((check) => check.id === 'asset-integrity')?.status).toBe('passed');
      expect(checks.find((check) => check.id === 'dialogue-coverage')?.status).toBe('passed');
    }
  });

  it('blocks gaps and out-of-range audio clips in the persisted timeline', () => {
    const document = voxRenderDocument('deterministic-layers');
    const scenes = buildDirectorRenderScenes(document);
    const broken = structuredClone(document);
    broken.timeline = structuredClone(document.timeline)!;
    broken.timeline.clips[0] = { ...broken.timeline.clips[0], startMs: broken.timeline.clips[0].startMs + 120 };
    broken.timeline.audioClips = [{ id: 'bad-audio', shotId: scenes[0].id, assetVersionId: 'audio-1', trackType: 'narration', startMs: -1, durationMs: 20_000 }];
    const result = evaluateDirectorQuality(broken, scenes, {
      outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: 2_000, sizeBytes: 128,
      width: 1920, height: 1080, hasAudio: true, hasVideo: true, hasNonBlackVideo: true,
      audioQualityStatus: 'ok', audioMeanVolumeDb: -20, audioPeakDb: -6, blackDetectionStatus: 'ok', blackIntervalsMs: [],
    }, directorDocumentRenderFingerprint(broken));
    expect(result.find((check) => check.id === 'timeline-continuity')).toMatchObject({ status: 'failed', severity: 'blocking', recheckScope: { kind: 'media' } });
  });

  it('checks individual cuts, clip identity and finite times while accepting optional audio duration', () => {
    const source = voxRenderDocument('deterministic-layers');
    source.beats[0].shots.push({ ...structuredClone(source.beats[0].shots[0]), id: 'shot-2', subtitleCueIds: [] });
    const document = rebuildEditorialTimeline(source);
    const scenes = buildDirectorRenderScenes(document);
    const render = { outputPath: 'I:/work/director-renders/r1/exports/final.mp4', durationMs: 4000, sizeBytes: 128, width: 1920, height: 1080, hasAudio: true as const, hasVideo: true as const, hasNonBlackVideo: true as const };
    const check = (next = document) => evaluateDirectorQuality(next, scenes, render, directorDocumentRenderFingerprint(next)).find((item) => item.id === 'timeline-continuity');
    expect(check()?.status).toBe('passed');
    for (const edit of [
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].startMs += 100; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].startMs -= 100; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].durationMs = NaN; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].startMs = Infinity; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.durationMs = NaN; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].id = timeline.clips[0].id; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips[1].shotId = timeline.clips[0].shotId; },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips.reverse(); },
      (timeline: NonNullable<typeof document.timeline>) => { timeline.clips.pop(); },
    ]) {
      const changed = structuredClone(document);
      edit(changed.timeline!);
      expect(check(changed)).toMatchObject({ status: 'failed', severity: 'blocking' });
    }
    for (const duration of [undefined, 1000]) {
      const changed = structuredClone(document);
      changed.timeline!.audioClips = [{ id: 'ambience', shotId: 'shot-2', assetVersionId: 'asset-voice', trackType: 'ambience', startMs: 2500, sourceDurationMs: duration }];
      expect(check(changed)?.status).toBe('passed');
      changed.timeline!.audioClips[0].startMs = 1900;
      expect(check(changed)?.status).toBe('failed');
    }
    for (const width of [1080, NaN, Infinity]) {
      const checks = evaluateDirectorQuality(document, scenes, { ...render, width }, directorDocumentRenderFingerprint(document));
      expect(checks.find((item) => item.id === 'media-output')?.status).toBe('failed');
    }
  });
});

function validProbe() {
  return {
    duration: 2,
    has_audio: true,
    has_video: true,
    has_nonblack_video: true,
    width: 1920,
    height: 1080,
  };
}

function voxRenderDocument(strategy: 'deterministic-layers' | 'living-poster'): EditorialCollagePipelineData {
  const draft = createEditorialCollageDraft({
    id: 'vox-render',
    title: 'VOX render',
    ratio: '16:9',
    now: '2026-09-05T00:00:00.000Z',
  });
  return rebuildEditorialTimeline({
    ...draft,
    selectedStyleId: 'style-1',
    styleCandidates: [{ id: 'style-1', label: '档案', prompt: 'editorial', selected: true }],
    beats: [{
      id: 'beat-1',
      index: 1,
      title: '城市证据',
      narration: '第一句。第二句。',
      startMs: 0,
      durationMs: 2_000,
      subtitleCues: [
        { id: 'cue-1', startMs: 0, endMs: 900, text: '第一句' },
        { id: 'cue-2', startMs: 900, endMs: 2_000, text: '第二句' },
      ],
      shots: [{
        id: 'shot-1',
        beatId: 'beat-1',
        durationMs: 2_000,
        renderStrategy: strategy,
        scenePrompt: 'city evidence collage',
        motionPrompt: 'restrained parallax',
        layers: [
          {
            id: 'layer-bg',
            label: '背景',
            kind: 'background',
            source: 'generated-image',
            zIndex: 0,
            depth: -0.08,
            assetVersionId: 'asset-bg',
            motion: [
              { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
              { atMs: 2_000, x: 0.5, y: 0.5, scale: 1.04, rotation: 0, opacity: 1 },
            ],
          },
          {
            id: 'layer-subject',
            label: '主体',
            kind: 'subject',
            source: 'generated-image',
            zIndex: 10,
            depth: 0.12,
            assetVersionId: 'asset-subject',
            motion: [{ atMs: 0, x: 0.62, y: 0.5, scale: 0.96, rotation: -2, opacity: 0.92 }],
          },
        ],
        camera: [
          { atMs: 0, x: 0.5, y: 0.5, zoom: 1 },
          { atMs: 2_000, x: 0.48, y: 0.5, zoom: 1.06 },
        ],
        subtitleCueIds: ['cue-1', 'cue-2'],
        voiceAssetVersionId: 'asset-voice',
        ...(strategy === 'living-poster' ? { videoAssetVersionId: 'asset-video', videoJobId: 'job-video' } : {}),
        layoutTemplate: '对比拼贴 · 纸张撕裂',
        motionPreset: '轻微视差',
        subtitleStyle: '简体中文 · 下方黑底',
      }],
    }],
    assets: [
      { id: 'asset-bg', assetId: 'background', kind: 'image', localPath: 'C:/managed/background.png', createdAt: draft.createdAt },
      { id: 'asset-subject', assetId: 'subject', kind: 'image', localPath: 'C:/managed/subject.png', createdAt: draft.createdAt },
      { id: 'asset-voice', assetId: 'voice', kind: 'audio', localPath: 'C:/managed/voice.wav', createdAt: draft.createdAt },
      { id: 'asset-video', assetId: 'video', kind: 'video', localPath: 'C:/managed/shot-1.mp4', providerJobId: 'job-video', createdAt: draft.createdAt },
    ],
    providerJobs: [{
      id: 'job-video',
      workflowKind: 'editorial-collage',
      nodeId: 'shot-1',
      providerId: 'video-provider',
      model: 'image-to-video-v1',
      capability: 'image-to-video',
      status: 'completed',
      inputHash: 'input-hash',
      idempotencyKey: 'vox-render:shot-1:input-hash:1',
      estimatedCost: 0.1,
      attempt: 1,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }],
  });
}
