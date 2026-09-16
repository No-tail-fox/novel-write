import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { MusicProfileManager, ProfileSecretField, TranscriptionVisionProfileSwitcher, VideoProfileSwitcher, VisionProfileManager } from '../src/features/settings/MusicVideoProfileManagers';
import { profileSecretId, type SecretEditor } from '../src/features/settings/settings-controls';
import { StoryDreamProvider } from '../src/ui';

const secrets: SecretEditor = { value: () => '', configured: () => true, reference: (id) => ({ value: '', secretId: id }), change: vi.fn() };
const config = normalizeAppConfig({ ...defaultConfig, music: { enabled: true, activeProfileId: 'music-active', profiles: [
  { ...defaultConfig.music.profiles[0], id: 'music-active', name: '日常创作', model: 'suno-v6', useEnvironmentKey: true },
  { ...defaultConfig.music.profiles[0], id: 'music-draft', name: '轻量试作', model: 'suno-v6-mini', baseUrl: 'https://music.example', useEnvironmentKey: false },
] } });

function render(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(StoryDreamProvider, { theme: 'light', children: element }));
}
function managerProps() {
  return { config, selectedProfileId: 'music-draft', saving: false, onChange: vi.fn(), onSelectedProfileIdChange: vi.fn(), onActivate: vi.fn(async () => {}) };
}

describe('music and video settings', () => {
  it('shows the selected draft while retaining a separate active configuration', () => {
    const props = managerProps();
    const html = render(createElement(MusicProfileManager, { ...props, secrets }));
    expect(html).toContain('value="轻量试作"');
    expect(html).toContain('value="suno-v6-mini" selected');
    expect(html).toContain('启用中');
    expect(html).toContain('启用此配置');
    expect(html).toContain('保存配置会保留当前启用项');
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onActivate).not.toHaveBeenCalled();
    expect(config.music.activeProfileId).toBe('music-active');
  });

  it('restricts registered system keys to the Suno site and provides a separate credential field', () => {
    const html = render(createElement(MusicProfileManager, { ...managerProps(), secrets }));
    expect(html).toContain('系统 Suno 密钥仅用于已登记站点');
    expect(html).toMatch(/<input(?=[^>]*disabled)(?=[^>]*type="checkbox")[^>]*>/);
    expect(html).toContain('API Key');
    expect(html).toContain('保存的密钥不会在界面中回显');
    const registered = render(createElement(MusicProfileManager, { ...managerProps(), selectedProfileId: 'music-active', secrets }));
    expect(registered).toContain('无需重复填写');
    expect(registered).not.toContain('type="password"');
  });

  it('addresses only the selected profile credential without displaying saved values', () => {
    const captured: string[] = [];
    const html = render(createElement(ProfileSecretField, { domain: 'music', profileId: 'recording/a', secrets: { ...secrets, value: (id) => { captured.push(id); return ''; } } }));
    expect(captured).toContain('music/recording%2Fa/apiKey');
    expect(profileSecretId('music', 'recording/a', 'apiKey')).toBe('music/recording%2Fa/apiKey');
    expect(html).toContain('type="password"');
    expect(html).toContain('已保存密钥；输入新值可替换');
  });

  it('presents all saved video models without changing the active provider on selection', () => {
    const videoConfig = normalizeAppConfig({ ...config, video: { ...config.video, activeProviderId: 'video-one', providers: [
      { ...config.video.providers[0], id: 'video-one', name: '默认视频', model: 'model-one', enabled: true },
      { ...config.video.providers[0], id: 'video-two', name: '备用视频', model: 'model-two', enabled: false },
    ] } });
    const onChange = vi.fn();
    const html = render(createElement(VideoProfileSwitcher, { ...managerProps(), config: videoConfig, selectedProfileId: 'video-two', onChange }));
    expect(html).toContain('model-one');
    expect(html).toContain('model-two');
    expect(html).toContain('正在编辑：');
    expect(html).toContain('启用此配置');
    expect(onChange).not.toHaveBeenCalled();
    expect(videoConfig.video.activeProviderId).toBe('video-one');
  });

  it('renders a selected transcription profile independently from the active transcription service', () => {
    const sttConfig = normalizeAppConfig({ ...config, activeSpeechToTextProfileId: 'stt-one', speechToTextProfiles: [
      { ...config.speechToText, id: 'stt-one', name: '日常转写', model: 'model-one', enabled: true },
      { ...config.speechToText, id: 'stt-two', name: '备用转写', model: 'model-two', enabled: false },
    ] });
    const onChange = vi.fn();
    const html = render(createElement(TranscriptionVisionProfileSwitcher, { ...managerProps(), domain: 'speechToText', config: sttConfig, selectedProfileId: 'stt-two', onChange }));
    expect(html).toContain('model-one');
    expect(html).toContain('model-two');
    expect(html).toContain('启用此配置');
    expect(onChange).not.toHaveBeenCalled();
    expect(sttConfig.activeSpeechToTextProfileId).toBe('stt-one');
  });

  it('edits the selected visual model and its own credential slot', () => {
    const visionConfig = normalizeAppConfig({ ...config, viral: { ...config.viral, activeVisionProfileId: 'vision-one', visionProfiles: [
      { ...config.viral.vision, id: 'vision-one', name: '日常视觉', model: 'vision-one-model', enabled: true },
      { ...config.viral.vision, id: 'vision-two', name: '备用视觉', model: 'vision-two-model', enabled: false },
    ] } });
    const captured: string[] = [];
    const html = render(createElement(VisionProfileManager, { ...managerProps(), config: visionConfig, selectedProfileId: 'vision-two', secrets: { ...secrets, value: (id) => { captured.push(id); return ''; } } }));
    expect(html).toContain('value="vision-two-model"');
    expect(html).toContain('视觉模型协议');
    expect(captured).toContain('viralVision/vision-two/apiKey');
    expect(visionConfig.viral.activeVisionProfileId).toBe('vision-one');
  });
});
