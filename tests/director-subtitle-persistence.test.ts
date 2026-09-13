import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { estimateDirectorSubtitleCue, updateDirectorSubtitleCue, type DirectorSubtitleDocument } from '../src/shared/director-subtitles';
import { parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { FileDatabase } from '../src/shared/storage';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

describe.each(['editorial-collage', 'motion-comic'] as const)('%s subtitle persistence', (workflow) => {
  it('saves word alignment, closes and reopens the database, then edits only the selected cue', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'storydream-subtitle-persistence-'));
    let database = await FileDatabase.open(join(directory, 'storydream.db'));
    try {
      const task = workflow === 'editorial-collage'
        ? await database.createEditorialCollageTask({ title: '咖啡与城市', sourceText: '城市开始改变。人们在咖啡馆交换消息。报纸与思想传播到每一个街区。新的公共生活由此形成。', ratio: '16:9' })
        : await database.createMotionComicTask({ title: '未来来信', premise: '女孩在雨夜收到一封来自未来的信。', episodeTitle: '第一集', ratio: '16:9' });
      let document = parseDocument(task.pipelineData);
      // This persistence case needs two cues in one shot, independently of starter segmentation.
      if (document.workflowKind === 'editorial-collage') {
        const beat = document.beats[0];
        const firstShot = beat.shots[0];
        const cue = beat.subtitleCues.find(item => item.id === firstShot.subtitleCueIds[0])!;
        const endMs = cue.endMs;
        cue.endMs = (cue.startMs + endMs) / 2;
        const sibling = { ...cue, id: 'persistence-sibling', startMs: cue.endMs, endMs, text: '同镜头另一句字幕。' };
        beat.subtitleCues.push(sibling);
        firstShot.subtitleCueIds.push(sibling.id);
        document = rebuildEditorialTimeline(document);
      }
      const shot = document.workflowKind === 'editorial-collage'
        ? document.beats.flatMap((beat) => beat.shots).find((item) => item.subtitleCueIds.length >= 2)!
        : document.episodes[0].scenes.flatMap((scene) => scene.shots).find((item) => item.dialogueCueIds.length >= 2)!;
      const cueIds = 'subtitleCueIds' in shot ? shot.subtitleCueIds : shot.dialogueCueIds;
      const beforeSibling = allCues(document).find((cue) => cue.id === cueIds[1]);
      const styled = updateDirectorSubtitleCue(document, shot.id, cueIds[0], { styleRef: 'karaoke-yellow' });
      const estimated = estimateDirectorSubtitleCue(styled, shot.id, cueIds[0]);
      const saved = estimated.workflowKind === 'editorial-collage'
        ? await database.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: document.updatedAt, document: estimated })
        : await database.saveMotionComicTask({ id: task.id, expectedUpdatedAt: document.updatedAt, document: estimated });
      await database.close();
      database = await FileDatabase.open(join(directory, 'storydream.db'));
      const stored = await database.getTaskDetail(saved.id);
      const reopened = parseDocument(stored!.pipelineData);
      const reopenedCue = allCues(reopened).find((cue) => cue.id === cueIds[0])!;
      expect(reopenedCue).toEqual(allCues(estimated).find((cue) => cue.id === cueIds[0]));
      expect(reopenedCue).toMatchObject({ styleRef: 'karaoke-yellow', alignmentSource: 'estimated' });
      expect(reopenedCue.tokens!.length).toBeGreaterThan(0);
      expect(allCues(reopened).find((cue) => cue.id === cueIds[1])).toEqual(beforeSibling);
      expect(reopened.updatedAt).not.toBe(document.updatedAt);

      const edited = updateDirectorSubtitleCue(reopened, shot.id, cueIds[0], { text: '保存后只更新这一句。' });
      const resaved = edited.workflowKind === 'editorial-collage'
        ? await database.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: reopened.updatedAt, document: edited })
        : await database.saveMotionComicTask({ id: task.id, expectedUpdatedAt: reopened.updatedAt, document: edited });
      const finalDocument = parseDocument(resaved.pipelineData);
      expect(allCues(finalDocument).find((cue) => cue.id === cueIds[0])).toMatchObject({ text: '保存后只更新这一句。', styleRef: 'karaoke-yellow' });
      expect(allCues(finalDocument).find((cue) => cue.id === cueIds[0])).not.toHaveProperty('tokens');
      expect(allCues(finalDocument).find((cue) => cue.id === cueIds[1])).toEqual(beforeSibling);
    } finally {
      await database.close();
      await removeTestTempDirectories(directory);
    }
  });
});

function parseDocument(value: unknown): DirectorSubtitleDocument {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  return document.workflowKind === 'editorial-collage' ? parseEditorialCollagePipelineData(document) : parseMotionComicPipelineData(document);
}

function allCues(document: DirectorSubtitleDocument) {
  return document.workflowKind === 'editorial-collage' ? document.beats.flatMap((beat) => beat.subtitleCues) : document.episodes.flatMap((episode) => episode.dialogueCues);
}
