import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVideoProviderOptions, resolveDirectorVideoProviderStatus, resolveDirectorVoiceProviderStatus, applyEditorialImageRecord, applyEditorialStyleCandidateRecord, applyMotionComicImageRecord, applyEditorialVoiceRecord, applyMotionComicVoiceRecord, directorImageInput, directorStyleCandidateInput } from '../src/features/director-desk/director-generation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, validateEditorialCollagePipeline, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { ImageLabRecord, VoiceLabRecord } from '../src/shared/types';

const generatedImage = (status: ImageLabRecord['status'] = 'generated'): ImageLabRecord => ({
  id: 'image-task-1',
  prompt: 'a clean documentary keyframe',
  ratio: '16:9',
  style: 'cinematic',
  provider: 'gpt_image',
  imagePath: status === 'generated' ? 'C:/storydream/image-task-1.png' : '',
  status,
  errorMessage: status === 'failed' ? 'provider rejected prompt' : '',
  resolution: '2K',
  quality: 'medium',
  smartMode: 'video-narration',
  referenceImagePaths: [],
  referenceImagePath: '',
  upstreamTaskId: null,
  createdAt: '2026-08-18T01:00:00.000Z',
  finishedAt: '2026-08-18T01:00:03.000Z',
});

const generatedVoice = (status: VoiceLabRecord['status'] = 'generated'): VoiceLabRecord => ({
  id: 'voice-task-1',
  text: '这是一段镜头旁白。',
  provider: 'minimax',
  voiceId: 'male-qn-jingying',
  voiceLabel: '精英青年',
  speed: 1,
  audioPath: status === 'generated' ? 'C:/storydream/voice-task-1.mp3' : '',
  status,
  errorMessage: status === 'failed' ? 'tts rejected request' : '',
  createdAt: '2026-08-18T01:01:00.000Z',
  finishedAt: '2026-08-18T01:01:03.000Z',
});

describe('director desk generation contracts', () => {
  it.each(['editorial-collage', 'motion-comic'] as const)('keeps the 101st image generation saveable in %s', (kind) => {
    const now = '2026-08-18T00:00:00.000Z';
    const initial = kind === 'editorial-collage'
      ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox-history', title: '历史', ratio: '16:9', now }), '保留全部版本。', now)
      : createMotionComicStarterProject(createMotionComicDraft({ id: 'comic-history', title: '历史', premise: '保留全部版本。', ratio: '9:16', now }), '第一集', now);
    const shotId = initial.workflowKind === 'editorial-collage' ? initial.beats[0].shots[0].id : initial.episodes[0].scenes[0].shots[0].id;
    const first = initial.workflowKind === 'editorial-collage'
      ? applyEditorialImageRecord(initial, shotId, generatedImage(), 'qa-model')
      : applyMotionComicImageRecord(initial, shotId, generatedImage(), 'qa-model');
    const document = { ...first, providerJobs: Array.from({ length: 100 }, (_, index) => ({ ...first.providerJobs[0], id: index === 0 ? first.providerJobs[0].id : `old-job-${index}`, attempt: index + 1 })) };
    const next = document.workflowKind === 'editorial-collage'
      ? applyEditorialImageRecord(document, shotId, { ...generatedImage(), id: 'new-image' }, 'qa-model')
      : applyMotionComicImageRecord(document, shotId, { ...generatedImage(), id: 'new-image' }, 'qa-model');
    const saved = kind === 'editorial-collage' ? parseEditorialCollagePipelineData(JSON.stringify(next)) : parseMotionComicPipelineData(JSON.stringify(next));
    expect(saved.providerJobs.at(-1)?.attempt).toBe(101);
    expect(saved.providerJobs).toHaveLength(101);
    expect(saved.assets).toHaveLength(2);
    expect(saved.assets.at(-1)?.id).toBe('image-asset-new-image');
  });

  it('keeps renderer video preflight on the browser-safe routing boundary', async () => {
    const [generationSource, routingSource] = await Promise.all([
      readFile(new URL('../src/features/director-desk/director-generation.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/video-routing.ts', import.meta.url), 'utf8'),
    ]);
    expect(generationSource).toContain("from '../../shared/video-routing'");
    expect(generationSource).not.toContain("from '../../shared/video-provider'");
    expect(routingSource).not.toMatch(/from ['"]node:|\bprocess\./u);
  });

  it('reports the configured input.im provider only when its credential status is present', () => {
    const config = { ...defaultConfig, imageProvider: 'gpt_image' as const, gptImage: { ...defaultConfig.gptImage, baseUrl: 'https://ai.input.im' } };
    const activeId = encodeURIComponent(config.activeImageProfileId);
    expect(resolveDirectorImageProviderStatus(config, { [`image/${activeId}/gptImage/apiKey`]: true })).toMatchObject({ connected: true, model: 'gpt-image-2' });
    expect(resolveDirectorImageProviderStatus(config, {})).toMatchObject({ connected: false, provider: 'gpt_image' });
  });

  it('lists every configured image profile and resolves inactive profile credentials independently', () => {
    const config = {
      ...defaultConfig,
      activeImageProfileId: 'gpt-profile',
      imageProfiles: [
        { id: 'gpt-profile', name: 'GPT Image', enabled: true, provider: 'gpt_image' as const, gptImage: { ...defaultConfig.gptImage, baseUrl: 'https://images.example.test', model: 'gpt-image-2' } },
        { id: 'custom-profile', name: '片场绘图', enabled: false, provider: 'custom' as const, customImage: { ...defaultConfig.customImage, baseUrl: 'https://images.example.test', model: 'studio-image-v1' } },
      ],
    };
    const options = resolveDirectorImageProviderOptions(config, {
      'image/gpt-profile/gptImage/apiKey': true,
      'image/custom-profile/customImage/apiKey': true,
    });
    expect(options).toMatchObject([
      { profileId: 'gpt-profile', connected: true, provider: 'gpt_image', model: 'gpt-image-2' },
      { profileId: 'custom-profile', connected: true, provider: 'custom', model: 'studio-image-v1' },
    ]);
    expect(resolveDirectorImageProviderStatus(config, { 'image/custom-profile/customImage/apiKey': true }, 'custom-profile')).toMatchObject({ connected: true, provider: 'custom', model: 'studio-image-v1' });
  });

  it('reports the active TTS profile from encrypted secret status', () => {
    const config = {
      ...defaultConfig,
      activeTtsProfileId: 'default-tts',
      tts: { ...defaultConfig.tts, provider: 'minimax' as const },
      ttsProfiles: [{ ...defaultConfig.ttsProfiles[0], id: 'default-tts', provider: 'minimax' as const, minimax: { ...defaultConfig.tts.minimax, model: 'speech-02-hd', voiceId: 'male-qn-jingying' } }],
    };
    expect(resolveDirectorVoiceProviderStatus(config, { 'tts/default-tts/minimax/apiKey': true })).toMatchObject({ connected: true, provider: 'minimax', model: 'speech-02-hd', voiceId: 'male-qn-jingying' });
    expect(resolveDirectorVoiceProviderStatus(config, {})).toMatchObject({ connected: false, provider: 'minimax' });
  });

  it('preflights I2V credentials, duration, whitelist, and remaining budget before VOX video generation', () => {
    const baseProvider = {
      ...defaultConfig.video.providers[0],
      enabled: true,
      baseUrl: 'https://video.example.test/v1',
      model: 'video-v1',
      capabilities: ['i2v' as const],
    };
    const config = {
      ...defaultConfig,
      video: {
        ...defaultConfig.video,
        activeProviderId: 'short-i2v',
        providers: [
          { ...baseProvider, id: 'short-i2v', name: '短片服务', maxDurationSec: 3, pricePerSecond: 1 },
          { ...baseProvider, id: 'long-i2v', name: '长片服务', maxDurationSec: 10, pricePerSecond: 2 },
        ],
        automation: {
          ...defaultConfig.video.automation,
          budgetLimit: 20,
          providerWhitelist: ['short-i2v', 'long-i2v'],
        },
      },
    };
    const secrets = { 'video/short-i2v/apiKey': true, 'video/long-i2v/apiKey': true };

    expect(resolveDirectorVideoProviderOptions(config, secrets)).toMatchObject([
      { providerId: 'short-i2v', connected: true },
      { providerId: 'long-i2v', connected: true },
    ]);
    expect(resolveDirectorVideoProviderStatus(config, secrets, { durationMs: 5000 })).toMatchObject({
      connected: true,
      providerId: 'long-i2v',
      estimatedCost: 10,
      remainingBudget: 20,
    });
    expect(resolveDirectorVideoProviderStatus(config, secrets, { durationMs: 5000, committedCost: 11 })).toMatchObject({
      connected: false,
      remainingBudget: 9,
    });
    expect(resolveDirectorVideoProviderOptions(config, { 'video/short-i2v/apiKey': true })[1]).toMatchObject({
      providerId: 'long-i2v',
      connected: false,
      unavailableReason: '缺少 API Key',
    });
  });

  it('persists a generated VOX image as a selected layer asset and completed job', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-1', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const shot = document.beats[0].shots[0];
    const next = applyEditorialImageRecord(document, shot.id, generatedImage(), 'gpt-image-2');
    expect(next.assets.at(-1)).toMatchObject({ kind: 'image', localPath: 'C:/storydream/image-task-1.png', selected: true });
    expect(next.providerJobs.at(-1)).toMatchObject({ nodeId: shot.id, status: 'completed', capability: 'text-to-image' });
    expect(next.beats[0].shots[0].providerJobId).toBe('image-job-image-task-1');
    expect(next.beats[0].shots[0].layers.some((layer) => layer.assetVersionId === next.assets.at(-1)?.id)).toBe(true);
  });

  it('binds the selected VOX style candidate into every subsequent image request', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-style', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const shotId = document.beats[0].shots[0].id;
    const selected = { ...document, selectedStyleId: 'style-1', styleCandidates: document.styleCandidates.map((candidate, index) => ({ ...candidate, id: index === 0 ? 'style-1' : candidate.id, label: index === 0 ? '胶片纪实' : candidate.label, prompt: index === 0 ? 'muted 16mm grain, restrained contrast' : candidate.prompt, selected: index === 0 })) };
    const input = directorImageInput(selected, shotId);
    expect(input.styleCandidateId).toBe('style-1');
    expect(input.prompt).toContain('Style baseline (胶片纪实): muted 16mm grain, restrained contrast.');
  });

  it('keeps failed image attempts visible in the job history without linking an empty asset', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-2', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const next = applyEditorialImageRecord(document, document.beats[0].shots[0].id, generatedImage('failed'), 'gpt-image-2');
    expect(next.assets).toHaveLength(document.assets.length);
    expect(next.providerJobs.at(-1)).toMatchObject({ status: 'failed', error: 'provider rejected prompt' });
  });

  it('persists a generated VOX style sample as a candidate asset and tracks its provider job', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-style-sample', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const styleId = document.styleCandidates[0].id;
    const input = directorStyleCandidateInput(document, styleId);
    const next = applyEditorialStyleCandidateRecord(document, styleId, { ...generatedImage(), id: 'style-task-1', prompt: input.prompt }, 'gpt-image-2', input, true, { estimatedCost: 0.12, actualCost: 0.08 });
    const asset = next.assets.at(-1);
    expect(asset).toMatchObject({ assetId: `style-candidate-${styleId}`, selected: true, providerJobId: 'style-image-job-style-task-1' });
    expect(next.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId).toBe(asset?.id);
    expect(next.providerJobs.at(-1)).toMatchObject({ nodeId: `style-candidate:${styleId}`, capability: 'style-sample', status: 'completed', estimatedCost: 0.12, actualCost: 0.08 });
    expect(next.estimatedCost).toBeCloseTo(document.estimatedCost + 0.12);
    expect(next.actualCost).toBeCloseTo(0.08);
    expect(validateEditorialCollagePipeline(next)).toEqual([]);
  });

  it('keeps a failed or stale VOX style sample in history without replacing the candidate', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-style-stale', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const styleId = document.styleCandidates[0].id;
    const input = directorStyleCandidateInput(document, styleId);
    const first = applyEditorialStyleCandidateRecord(document, styleId, { ...generatedImage(), id: 'style-task-old', prompt: input.prompt }, 'gpt-image-2', input, true);
    const changed = { ...first, ratio: '1:1' as const };
    const stale = applyEditorialStyleCandidateRecord(changed, styleId, { ...generatedImage(), id: 'style-task-stale', prompt: input.prompt }, 'gpt-image-2', input, false);
    expect(stale.providerJobs.at(-1)).toMatchObject({ status: 'completed', nodeId: `style-candidate:${styleId}` });
    expect(stale.assets.at(-1)).toMatchObject({ selected: false });
    expect(stale.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId).toBe(first.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId);
    expect(stale.assets.find((asset) => asset.id === first.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId)?.selected).toBe(true);
    const failed = applyEditorialStyleCandidateRecord(stale, styleId, { ...generatedImage('failed'), id: 'style-task-failed', prompt: input.prompt }, 'gpt-image-2', input, true);
    expect(failed.providerJobs.at(-1)).toMatchObject({ status: 'failed', error: 'provider rejected prompt' });
    expect(failed.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId).toBe(stale.styleCandidates.find((candidate) => candidate.id === styleId)?.assetVersionId);
  });

  it('links a generated motion-comic keyframe to the selected shot', () => {
    const draft = createMotionComicDraft({ id: 'comic-1', title: 'AI 漫剧', premise: '雨夜来信', ratio: '9:16', now: '2026-08-18T00:00:00.000Z' });
    const document = createMotionComicStarterProject(draft, '第一集', '2026-08-18T00:00:00.000Z');
    const shot = document.episodes[0].scenes[0].shots[0];
    const next = applyMotionComicImageRecord(document, shot.id, generatedImage(), 'gpt-image-2');
    expect(next.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId).toBe(next.assets.at(-1)?.id);
    expect(next.episodes[0].status).toBe('keyframes');
    expect(next.stage).toBe('keyframes');
  });

  it('persists a generated VOX voice as a selected audio asset and shot reference', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-voice', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const shot = document.beats[0].shots[0];
    const next = applyEditorialVoiceRecord(document, shot.id, generatedVoice(), 'speech-02-hd', undefined, true, 2_300);
    expect(next.assets.at(-1)).toMatchObject({ kind: 'audio', localPath: 'C:/storydream/voice-task-1.mp3', selected: true, durationMs: 2_300 });
    expect(next.timeline?.audioClips?.find((clip) => clip.shotId === shot.id)).toMatchObject({ sourceDurationMs: 2_300, sourceMediaDurationMs: 2_300 });
    expect(next.providerJobs.at(-1)).toMatchObject({ nodeId: shot.id, status: 'completed', capability: 'text-to-speech' });
    expect(next.beats[0].shots[0]).toMatchObject({ voiceId: 'male-qn-jingying', voiceAssetVersionId: next.assets.at(-1)?.id });
  });

  it('links aggregate motion-comic voice audio to the shot and timeline without mislabelling individual dialogue', () => {
    const draft = createMotionComicDraft({ id: 'comic-voice', title: 'AI 漫剧', premise: '雨夜来信', ratio: '9:16', now: '2026-08-18T00:00:00.000Z' });
    const document = createMotionComicStarterProject(draft, '第一集', '2026-08-18T00:00:00.000Z');
    const shot = document.episodes[0].scenes[0].shots[0];
    const next = applyMotionComicVoiceRecord(document, shot.id, generatedVoice(), 'speech-02-hd');
    const audioId = next.assets.at(-1)?.id;
    expect(next.stage).toBe('audio');
    expect(next.episodes[0].scenes[0].shots[0].voiceAssetVersionId).toBe(audioId);
    expect(next.episodes[0].dialogueCues.map((cue) => cue.text)).toEqual(document.episodes[0].dialogueCues.map((cue) => cue.text));
    expect(next.episodes[0].dialogueCues.filter((cue) => cue.shotId === shot.id).every((cue) => cue.audioAssetVersionId === audioId && !cue.tokens)).toBe(true);
    expect(next.episodes[0].dialogueCues.some((cue) => cue.voiceAssetVersionId === audioId)).toBe(false);
    expect(next.episodes[0].timeline.audioAssetVersionIds).toContain(audioId);
  });

  it('binds an independently generated recording to only its dialogue cue', () => {
    const draft = createMotionComicDraft({ id: 'comic-cue-voice', title: 'AI 漫剧', premise: '雨夜来信', ratio: '9:16', now: '2026-08-18T00:00:00.000Z' });
    const document = createMotionComicStarterProject(draft, '第一集', '2026-08-18T00:00:00.000Z');
    const shot = document.episodes[0].scenes[0].shots[0];
    const cues = document.episodes[0].dialogueCues.filter((cue) => cue.shotId === shot.id);
    const next = applyMotionComicVoiceRecord(document, shot.id, generatedVoice(), 'speech-02-hd', cues[0].id);
    const audioId = next.assets.at(-1)?.id;
    expect(next.episodes[0].dialogueCues.find((cue) => cue.id === cues[0].id)?.voiceAssetVersionId).toBe(audioId);
    expect(next.episodes[0].dialogueCues.find((cue) => cue.id === cues[1]?.id)?.voiceAssetVersionId).toBeUndefined();
    expect(next.episodes[0].timeline.audioAssetVersionIds).toContain(audioId);
  });
});
