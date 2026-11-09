import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { listVoxProductionProjects } from '../electron/vox-production-projects';
import { parseEditorialCollagePipelineData } from '@shared/editorial-collage';
import { taskHistoryTypeLabel } from '../src/features/tasks/task-formatters';

describe('music MV Lemo project persistence', () => {
  it('reopens the complete project and includes it in the Music MV project filter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'music-mv-project-'));
    const file = join(dir, 'storydream.db');
    let db = await FileDatabase.open(file);
    try {
      const task = await db.createMusicMvProjectTask({ title: 'MV', inputText: 'One\nTwo\nThree', taskKind: 'music-mv', track: 'music-mv', storyboardSceneCount: 2, musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'minimal', visualMotif: '', audioPath: 'song.wav' } }, 6000);
      expect(task).toMatchObject({ taskKind: 'music-mv', taskType: 'editorial-collage', status: 'draft', track: 'music-mv' });
      expect(taskHistoryTypeLabel(task)).toBe('音乐 MV');
      await db.close();
      db = await FileDatabase.open(file);
      const loaded = await db.getTaskDetail(task.id);
      expect(parseEditorialCollagePipelineData(loaded!.pipelineData).productionSettings?.music?.path).toBe('song.wav');
      expect((await db.listTaskSummaries({ taskType: 'music-mv' })).items.map(t => t.id)).toContain(task.id);
      expect((await db.listTaskSummaries({ taskType: 'editorial-collage' })).items.map(t => t.id)).not.toContain(task.id);
      expect(await listVoxProductionProjects(db)).toContain(task.id);
      await expect(db.createMusicMvProjectTask({ inputText: 'One', musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'none', visualMotif: '', audioPath: '' } }, 6000)).rejects.toThrow('AUDIO_REQUIRED');
      expect((await db.listTaskSummaries()).items).toHaveLength(1);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
