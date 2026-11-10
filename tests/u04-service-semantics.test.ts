import { readFile } from 'node:fs/promises';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/app/app-state';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { MusicMvPage } from '../src/features/music-mv/MusicMvPage';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { StoryDreamProvider } from '../src/ui/StoryDreamProvider';
import { fieldControl, markupText } from './helpers/ssr-markup';

// Server markup cannot mount a Fluent portal; render the inspector drawer inline.
vi.mock('../src/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui')>(),
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', { 'data-ssr-inspector': true }, children),
}));

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('U04 service terminology and capability semantics', () => {
  it('keeps voice selection in the voice inspector instead of a fake single-option dropdown', () => {
    const markup = renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
      mode: 'motion-comic', projectTitle: '雨夜来信', projectMeta: '', episodeTitle: '第 1 集', stageLabel: '镜头生成',
      selectedShotId: 'shot', dirty: false, providerConnected: true,
      shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' }],
      onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    }));
    // The generation inspector shows a read-only "音色" field that defers to the narration settings…
    const voiceField = fieldControl(markup, '音色');
    expect(voiceField).toBeDefined();
    expect(voiceField).toMatch(/^<input\b/u);
    expect(voiceField).toContain('readOnly=""');
    expect(voiceField).toContain('value="跟随旁白设置"');
    expect(markupText(markup)).toContain('请在“旁白与字幕”中选择真实音色');
    // …and never offers a hard-coded celebrity voice.
    expect(markup.includes('李立宏（男声）')).toBe(false);
  });

  it('blocks image profiles that cannot support the workflow before saving them', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    // Image profiles are now fixed per project (ProjectModelFields); neither workspace can write an image
    // profile into the global config any more, so an unsupported profile can never be saved from here.
    for (const page of [vox, comic]) {
      expect(page).not.toContain('onProviderProfileChange=');
      expect(page).not.toContain('api.saveConfig({ config: enableImageProfile');
      expect(page).toContain("if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');");
    }
    // AI comics need reference-image editing: unsupported profiles stay unselectable, the workspace reports
    // them as unavailable, and generation refuses to start with them.
    expect(comic).toContain('disabled: !profile.connected || !profile.supportsReferenceImages');
    expect(comic).toContain('const providerReady = providerStatus.connected && providerStatus.supportsReferenceImages;');
    expect(comic).toContain('providerConnected={providerReady}');
    expect(comic).toContain('不支持参考图编辑，请切换到 GPT Image 或兼容的自定义图片服务。');
    expect(comic).toContain('if (!providerStatus.supportsReferenceImages) throw new Error(`${providerStatus.label} 不支持参考图编辑，请先切换生成服务。`);');
    // Vox does not require reference images, so only disconnected profiles are blocked there.
    expect(vox).not.toContain('if (!option.supportsReferenceImages)');
    expect(vox).toContain('disabled: !profile.connected');
  });

  it('does not persist a fallback celebrity voice when narration is disconnected', async () => {
    const [vox, comic] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);
    expect(vox).toContain('const createVoiceIdForProject = voiceStatus.connected');
    expect(vox).toContain('voiceId: createVoiceIdForProject');
    expect(vox).toContain(': undefined;');
    // AI comic creation no longer seeds a project voice at all: shots and characters start without a
    // voiceId ("跟随镜头默认音色"), and the provider default is never copied into the document.
    expect(comic).not.toContain('voiceStatus.voiceId');
    expect(comic).not.toContain('createVoiceId');
    expect(comic).toContain("{ value: '', label: '跟随镜头默认音色' }");
    expect(comic).toContain("if (!voiceStatus.connected) throw new Error(voiceStatus.unavailableReason ?? '旁白服务未配置。');");
  });

  it('renders Chinese labels for MV preview enums', async () => {
    // The MV page is now a creation form handing off to the Lemo workbench; every MV enum it shows must
    // render with a Chinese label rather than the raw enum value.
    const html = renderToStaticMarkup(createElement(StoryDreamProvider, { theme: 'light', children:
      createElement(WorkspaceNavigationProvider, { children: createElement(MusicMvPage, {
        api: {} as StoryDreamApi, state: initialState, applyState: vi.fn(), openTaskDetail: vi.fn(), isBrowserPreview: true,
      }) }),
    }));
    const visibleText = html.replace(/<[^>]*>/gu, '\n');
    for (const label of ['歌词同步', '快切', '慢镜头', '极简', '卡拉 OK', '无字幕']) expect(visibleText).toContain(label);
    for (const rawEnum of ['lyric-sync', 'fast-cut', 'slow-cinematic', 'minimal', 'karaoke', 'intro', 'outro', 'verse', 'chorus', 'bridge']) {
      expect(visibleText, rawEnum).not.toMatch(new RegExp(`(^|[^a-z-])${rawEnum}([^a-z-]|$)`, 'u'));
    }
    const page = await source('src/features/music-mv/MusicMvPage.tsx');
    expect(page).not.toContain("index === 0 ? 'intro'");
    expect(page).not.toContain("index === lyricLines.length - 1 ? 'outro'");
  });
});
