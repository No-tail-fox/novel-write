import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { directorPhases, directorPhaseForStage, directorPhaseComplete } from '../src/features/director-desk/director-workspace-navigation';

describe('preview-first director workspace', () => {
  it('maps all seven existing steps to four phases without losing a step', () => {
    expect(directorPhases.map((phase) => phase.label)).toEqual(['文案', '分镜', '声音', '交付']);
    expect(directorPhases.flatMap((phase) => [...phase.stages])).toEqual(['剧本', '画面拆解', '素材一致性', '镜头生成', '配音字幕', '审片', '导出']);
    for (const phase of directorPhases) {
      for (const stage of phase.stages) expect(directorPhaseForStage(stage).id).toBe(phase.id);
      expect(phase.stages).toContain(phase.entry);
    }
    expect(directorPhaseForStage('旧版未知步骤').id).toBe('storyboard');
  });

  it('requires every owned step before marking a phase complete', () => {
    expect(directorPhaseComplete(directorPhases[1], ['画面拆解', '素材一致性'])).toBe(false);
    expect(directorPhaseComplete(directorPhases[1], ['画面拆解', '素材一致性', '镜头生成'])).toBe(true);
    expect(directorPhaseComplete(directorPhases[3], ['审片'])).toBe(false);
    expect(directorPhaseComplete(directorPhases[3], ['审片', '导出'])).toBe(true);
  });

  it('keeps canonical selection, real media and compact pane escape routes', async () => {
    const source = await readFile(new URL('../src/features/director-desk/DirectorDeskWorkspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-workspace-layout="preview-first"');
    expect(source).toContain('directorPhaseForStage(activeStage)');
    expect(source).toContain('aria-current={activePhase.id === phase.id');
    expect(source).toContain('aria-expanded={leftPaneOpen}');
    expect(source).toContain('aria-controls="director-inspector"');
    expect(source).toContain('关闭项目与镜头');
    expect(source).toContain('关闭镜头检查器');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('director-shot-thumbnail');
    expect(source).not.toContain('image25-focused-desk');
    expect(source).toContain('onClick={() => selectShotAndSeek(shot.id)}');
    expect(source).toContain('container === filmstripRef.current');
    expect(source).toContain('container.scrollLeft += item.right - bounds.right');
    expect(source).not.toContain("busy ? '保存中'");
  });
});
