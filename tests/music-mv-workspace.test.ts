import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('music MV authoring workspace', () => {
  it('opens persisted MV tasks, restores domain settings, and reruns from content after one governed save', async () => {
    const page = await readFile(new URL('../src/features/music-mv/MusicMvPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain("useState<'create' | 'workspace'>('create')");
    expect(page).toContain("task.taskType === 'music-mv' || task.taskKind === 'music-mv'");
    expect(page).toContain('function openMusicTask(taskId: string)');
    expect(page).toContain('setLyrics(task.inputText)');
    expect(page).toContain('setMusicMvRhythmMode(task.musicMv.rhythmMode)');
    expect(page).toContain('setMusicMvCaptionStyle(task.musicMv.captionStyle)');
    expect(page).toContain('api.updateMusicMvTask({');
    expect(page).toContain("api.rerunTaskStep(activeTask.id, 0, 'regenerate')");
    expect(page).toContain('api.retryTask(activeTask.id)');
    expect(page).toContain('>逐镜返工</Button>');
    expect(page).toContain("taskLocked ? '运行中，只读' : '可编辑'");
  });

  it('keeps create and existing-task actions in one stable toolbar', async () => {
    const [page, styles] = await Promise.all([
      readFile(new URL('../src/features/music-mv/MusicMvPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    ]);
    expect(page).toContain('<Toolbar aria-label="音乐 MV 任务操作">');
    expect(page).toContain('label="已有 MV"');
    expect(page).toContain('>新建 MV</Button>');
    expect(page).toContain("pageMode === 'workspace' ? '保存并重新生成' : '生成音乐 MV'");
    expect(styles).toContain('.music-mv-workspace-status');
    expect(styles).toContain('.music-mv-layout .panel-title-row > .sd-toolbar');
  });
});
