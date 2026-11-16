import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileDatabase } from '../src/shared/storage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { updateMotionComicMakeShot, toggleMotionComicMakeAsset } from '../src/features/motion-comic/motion-comic-make-edits';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';
const fixture = () => createMotionComicStarterProject(createMotionComicDraft({ id: 'make-test', title: '测试', premise: '雨夜来信', now: '2026-01-01T00:00:00.000Z' }), '第一集', '2026-01-01T00:00:00.000Z');
const first = (d: ReturnType<typeof fixture>) => d.episodes[0].scenes[0].shots[0];
describe('make workspace canonical edits', () => {
  it('rapid duration edit and revert retime from latest draft', () => {
    const original = fixture(), shot = first(original);
    const changed = updateMotionComicMakeShot(original, shot.id, { durationMs: shot.durationMs + 2000 });
    const reverted = updateMotionComicMakeShot(changed, shot.id, { durationMs: shot.durationMs });
    expect(first(reverted).durationMs).toBe(shot.durationMs);
    expect(reverted.episodes[0].timeline.durationMs).toBe(original.episodes[0].timeline.durationMs);
    expect(reverted.episodes[0].timeline.clips.map(c => [c.startMs, c.durationMs])).toEqual(original.episodes[0].timeline.clips.map(c => [c.startMs, c.durationMs]));
  });
  it('rapid subtitle edit and revert compares current cues, retaining other edits', () => {
    const original = fixture(), shot = first(original), episode = original.episodes[0];
    const subtitle = shot.dialogueCueIds.map(id => episode.dialogueCues.find(c => c.id === id)?.text).filter(Boolean).join('\n');
    let next = updateMotionComicMakeShot(original, shot.id, { title: '新标题', prompt: '新画面', motionPrompt: '新运镜', subtitle: '修改的对白' });
    next = updateMotionComicMakeShot(next, shot.id, { subtitle });
    expect(first(next)).toMatchObject({ title: '新标题', prompt: '新画面', motionPrompt: '新运镜' });
    expect(first(next).dialogueCueIds.map(id => next.episodes[0].dialogueCues.find(c => c.id === id)?.text).join('\n')).toBe(subtitle);
  });
  it('keeps scenes exclusive and toggles props and looks independently', () => {
    let d = fixture(); const id = first(d).id;
    const look = d.characters[0].looks[0].id, prop = d.props[0].id, scene = d.sceneAssets[0].id;
    const initial = first(d).characterLookIds.includes(look);
    d = toggleMotionComicMakeAsset(d, id, look);
    expect(first(d).characterLookIds.includes(look)).toBe(!initial);
    const looks = [...first(d).characterLookIds];
    const propWas = first(d).propAssetIds.includes(prop);
    d = toggleMotionComicMakeAsset(d, id, prop);
    expect(first(d).propAssetIds.includes(prop)).toBe(!propWas);
    d = toggleMotionComicMakeAsset(d, id, scene);
    expect(first(d).sceneAssetId).toBe(scene);
    expect(first(d).characterLookIds).toEqual(looks);
    expect(toggleMotionComicMakeAsset(d, id, scene)).toBe(d);
    expect(toggleMotionComicMakeAsset(d, id, 'deleted-asset')).toBe(d);
  });
  it('saves actual edited fields and bindings then reopens database', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'make-edits-'));
    let db = await FileDatabase.open(join(directory, 'storydream.db'));
    try {
      const task = await db.createMotionComicTask({ title: '真实保存', premise: '雨夜来信', episodeTitle: '第一集', ratio: '16:9' });
      let d = parseMotionComicPipelineData(task.pipelineData); const id = first(d).id;
      d = updateMotionComicMakeShot(d, id, { title: '保存标题', prompt: '保存画面', motionPrompt: '保存运镜', subtitle: '保存对白', durationMs: 7000 });
      d = toggleMotionComicMakeAsset(d, id, d.props[0].id);
      const saved = await db.saveMotionComicTask({ id: task.id, expectedUpdatedAt: d.updatedAt, document: d });
      await db.close(); db = await FileDatabase.open(join(directory, 'storydream.db'));
      const reopened = parseMotionComicPipelineData((await db.getTaskDetail(saved.id))!.pipelineData);
      expect(first(reopened)).toMatchObject({ title: '保存标题', prompt: '保存画面', motionPrompt: '保存运镜', durationMs: 7000, propAssetIds: first(d).propAssetIds });
      expect(reopened.episodes[0].dialogueCues.find(c => c.id === first(reopened).dialogueCueIds[0])?.text).toBe('保存对白');
    } finally { await db.close(); await removeTestTempDirectories(directory); }
  });
});
