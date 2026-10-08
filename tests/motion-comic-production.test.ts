import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DirectorDeskWorkspace, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';

const shot: DirectorShot = {
  id: 'shot', index: 1, title: '来信', scene: '邮局', durationMs: 5_000,
  framing: '中景', characterLabel: '林夏', prompt: '雨夜邮局', motionPrompt: '镜头缓慢推近',
  subtitle: '', renderStrategy: 'living-poster', videoInputReady: true, videoFirstFrameReady: true,
};

function markup(stageLabel: string, mode: 'motion-comic' | 'vox' = 'motion-comic') {
  return renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
    mode, projectTitle: '雨夜来信', projectMeta: '', episodeTitle: '第一集', stageLabel,
    selectedShotId: shot.id, shots: [shot], dirty: false, providerConnected: true,
    onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    renderShotWorkflow: () => createElement('section', { 'data-video-readiness': true }, '视频准备度'),
  }));
}

describe('motion comic production tools', () => {
  it('separates keyframe and remote video operations using the parent stage', () => {
    const frames = markup('分镜图');
    expect(frames).toContain('更新关键帧');
    expect(frames).not.toContain('data-video-readiness');
    expect(frames).not.toContain('>生成视频<');
    const video = markup('视频生成');
    expect(video).toContain('data-video-readiness');
    expect(video).toContain('视频运动提示词');
    expect(video).toContain('>生成视频<');
    expect(video).not.toContain('更新关键帧');
    expect(video).not.toContain('director-phase-bar');
  });

  it('preserves the shared VOX navigation and combined generation tools', () => {
    const vox = markup('镜头生成', 'vox');
    expect(vox).toContain('director-phase-bar');
    expect(vox).toContain('更新关键帧');
    expect(vox).toContain('>生成视频<');
    expect(vox).toContain('data-video-readiness');
  });
});
