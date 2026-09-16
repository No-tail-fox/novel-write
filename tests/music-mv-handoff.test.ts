import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/app/app-state';
import { readWorkspaceDraft } from '../src/app/workspace-draft';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { MusicMvPage } from '../src/features/music-mv/MusicMvPage';
import { applyMusicMvHandoff, type MusicMvHandoff } from '../src/features/music-mv/music-mv-handoff';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { StoryDreamProvider } from '../src/ui/StoryDreamProvider';

const music: MusicMvHandoff = {
  id: 'generated-song-1', title: '海边的风', lyrics: '海风轻轻唱\n月光落在肩上', audioPath: 'I:/music/海边的风.mp3',
};

function renderMusicOffer(initialMusic?: MusicMvHandoff) {
  const onInitialMusicHandled = vi.fn();
  const api = { createAndRunTask: vi.fn() } as unknown as StoryDreamApi;
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, { theme: 'light', children:
    createElement(WorkspaceNavigationProvider, { children: createElement(MusicMvPage, {
      api, state: initialState, applyState: vi.fn(), openTaskDetail: vi.fn(), isBrowserPreview: true,
      initialMusic, onInitialMusicHandled,
    }) }),
  }));
  return { html, api, onInitialMusicHandled };
}

describe('music creation to MV handoff', () => {
  it('replaces song fields after draft restoration while preserving visual and workflow choices', () => {
    const defaults = {
      title: '音乐MV', lyrics: '默认歌词', musicMvAudioPath: '', bgmId: 'default-bgm',
      style: 'modern-film', ratio: '16:9', templateId: 'default-template', storyboardSceneCount: 12,
      processingMode: 'full-auto', pausePoint: 'critical', musicMvRhythmMode: 'lyric-sync',
      musicMvCaptionStyle: 'karaoke', musicMvVisualMotif: '雨夜霓虹',
    };
    const restored = readWorkspaceDraft(JSON.stringify({ version: 1, values: {
      ...defaults, title: '未完成的 MV', lyrics: '旧歌词', musicMvAudioPath: 'I:/music/old.wav',
      bgmId: 'old-song-bgm', style: 'watercolor', ratio: '9:16', templateId: 'custom-template',
      storyboardSceneCount: 8, processingMode: 'manual', pausePoint: 'every-step',
      musicMvRhythmMode: 'slow-cinematic', musicMvCaptionStyle: 'minimal', musicMvVisualMotif: '夏日海边',
    } }), defaults);
    const next = applyMusicMvHandoff(restored, music);

    expect(next).toEqual({ ...restored, title: music.title, lyrics: music.lyrics, musicMvAudioPath: music.audioPath, bgmId: '' });
    expect(restored.title).toBe('未完成的 MV');
    expect(restored.bgmId).toBe('old-song-bgm');
  });

  it('clears old lyrics for instrumental music instead of borrowing lyrics from an unrelated draft', () => {
    const next = applyMusicMvHandoff({ title: '旧歌', lyrics: '旧歌词', musicMvAudioPath: 'old.mp3', bgmId: 'old' }, { ...music, lyrics: '' });
    expect(next.lyrics).toBe('');
    expect(next.bgmId).toBe('');
  });

  it('offers explicit accept and ignore controls without consuming or applying the incoming song on render', () => {
    const { html, api, onInitialMusicHandled } = renderMusicOffer(music);
    expect(html).toContain('来自音乐创作：海边的风');
    expect(html).toContain('使用这首歌曲');
    expect(html).toContain('忽略');
    expect(html).toContain('value="音乐MV"');
    expect(html).not.toContain('value="海边的风"');
    expect(html).not.toContain(music.audioPath);
    expect(onInitialMusicHandled).not.toHaveBeenCalled();
    expect(api.createAndRunTask).not.toHaveBeenCalled();
  });

  it('requires downloaded audio before the song can be used and still offers ignore', () => {
    const { html } = renderMusicOffer({ ...music, audioPath: '' });
    expect(html).toContain('这首歌曲尚未下载');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
    expect(buttons.find((button) => button.includes('使用这首歌曲'))).toContain('disabled=""');
    expect(buttons.find((button) => button.includes('忽略'))).not.toContain('disabled=""');
  });

  it('does not add the handoff panel to ordinary MV creation', () => {
    expect(renderMusicOffer().html).not.toContain('来自音乐创作的歌曲');
  });
});
