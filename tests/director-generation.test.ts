import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVoiceProviderStatus, applyEditorialImageRecord, applyMotionComicImageRecord, applyEditorialVoiceRecord, applyMotionComicVoiceRecord } from '../src/features/director-desk/director-generation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
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

  it('keeps failed image attempts visible in the job history without linking an empty asset', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-2', title: 'VOX', ratio: '16:9', now: '2026-08-18T00:00:00.000Z' });
    const document = createEditorialCollageStarterPlan(draft, '拉萨从古城走向现代城市。', '2026-08-18T00:00:00.000Z');
    const next = applyEditorialImageRecord(document, document.beats[0].shots[0].id, generatedImage('failed'), 'gpt-image-2');
    expect(next.assets).toHaveLength(document.assets.length);
    expect(next.providerJobs.at(-1)).toMatchObject({ status: 'failed', error: 'provider rejected prompt' });
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
    const next = applyEditorialVoiceRecord(document, shot.id, generatedVoice(), 'speech-02-hd');
    expect(next.assets.at(-1)).toMatchObject({ kind: 'audio', localPath: 'C:/storydream/voice-task-1.mp3', selected: true });
    expect(next.providerJobs.at(-1)).toMatchObject({ nodeId: shot.id, status: 'completed', capability: 'text-to-speech' });
    expect(next.beats[0].shots[0]).toMatchObject({ voiceId: 'male-qn-jingying', voiceAssetVersionId: next.assets.at(-1)?.id });
  });

  it('links motion-comic voice audio to the shot, dialogue cues, and episode timeline', () => {
    const draft = createMotionComicDraft({ id: 'comic-voice', title: 'AI 漫剧', premise: '雨夜来信', ratio: '9:16', now: '2026-08-18T00:00:00.000Z' });
    const document = createMotionComicStarterProject(draft, '第一集', '2026-08-18T00:00:00.000Z');
    const shot = document.episodes[0].scenes[0].shots[0];
    const next = applyMotionComicVoiceRecord(document, shot.id, generatedVoice(), 'speech-02-hd');
    const audioId = next.assets.at(-1)?.id;
    expect(next.stage).toBe('audio');
    expect(next.episodes[0].scenes[0].shots[0].voiceAssetVersionId).toBe(audioId);
    expect(next.episodes[0].dialogueCues.filter((cue) => cue.shotId === shot.id).every((cue) => cue.voiceAssetVersionId === audioId)).toBe(true);
    expect(next.episodes[0].timeline.audioAssetVersionIds).toContain(audioId);
  });
});
