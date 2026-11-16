import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { appendMotionComicShot, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { AppMutationResult, ImageLabRecord } from '../src/shared/types';
import { importMotionComicFrame, motionComicFrameAssets, type MotionComicFrameSlot } from '../src/features/motion-comic/motion-comic-frame-import';
import { MotionComicFramePanel } from '../src/features/motion-comic/MotionComicFramePanel';

const now = '2026-11-15T00:00:00.000Z';
function setup(slot: MotionComicFrameSlot = 'first') {
  let live = createMotionComicStarterProject(createMotionComicDraft({ id: 'frame-import', title: '帧导入', premise: '雨夜', now }), '第一集', now);
  const scene = live.episodes[0].scenes[0];
  live = appendMotionComicShot(live, live.episodes[0].id, scene.id, { id: 'other-shot' });
  const shotId = scene.shots[0].id;
  const shot = () => live.episodes[0].scenes[0].shots.find(item => item.id === shotId)!;
  shot().videoAssetVersionId = 'old-video';
  shot().videoJobId = 'old-job';
  const record = { id: 'managed-record', imagePath: 'C:/managed/copied.png', status: 'generated', prompt: '本地帧', createdAt: now } as ImageLabRecord;
  const mutation = { kind: 'state-patch', revision: 1, patch: { kind: 'image-lab-upsert', record: { ...record, promptPreview: record.prompt } } } as AppMutationResult;
  const api = {
    selectLocalImage: vi.fn(async (_purpose?: 'video-reference') => 'C:/source/original.png' as string | null),
    addImageLabRecord: vi.fn(async () => mutation),
    getImageLabRecordDetail: vi.fn(async () => record),
  };
  const controller = new AbortController();
  let current = true;
  let persisted: typeof live | undefined;
  const onPhase = vi.fn();
  const applyMutation = vi.fn();
  const enqueue = vi.fn(async (_projectId: string, update: (value: typeof live) => typeof live) => {
    live = update(live);
    persisted = parseMotionComicPipelineData(JSON.stringify(live));
    return persisted;
  });
  return { api, controller, record, shot, shotId, onPhase, applyMutation, enqueue,
    get live() { return live; }, set live(value) { live = value; },
    get persisted() { return persisted; },
    invalidate: () => { current = false; },
    run: () => importMotionComicFrame({ api, projectId: 'frame-import', shotId, slot, signal: controller.signal, readCurrent: () => live, isCurrent: () => current, enqueue, applyMutation, onPhase }),
  };
}

describe('managed motion-comic frame import', () => {
  it.each(['first', 'last'] as const)('imports and persists the %s slot with managed bytes and video invalidation', async slot => {
    const h = setup(slot);
    const id = await h.run();
    expect(h.api.selectLocalImage).toHaveBeenCalledWith('video-reference');
    expect(h.api.addImageLabRecord).toHaveBeenCalledWith(expect.objectContaining({ imagePath: 'C:/source/original.png', provider: 'local-import', upstreamTaskId: 'frame-import' }));
    expect(h.persisted?.assets.find(asset => asset.id === id)?.localPath).toBe('C:/managed/copied.png');
    const shot = h.persisted?.episodes[0].scenes[0].shots[0];
    expect(shot?.[slot === 'first' ? 'firstFrameAssetVersionId' : 'lastFrameAssetVersionId']).toBe(id);
    expect(shot?.videoAssetVersionId).toBeUndefined();
    expect(shot?.videoJobId).toBeUndefined();
    expect(h.onPhase).toHaveBeenCalledWith('saving');
    expect(motionComicFrameAssets(h.persisted!)).toHaveLength(1);
  });

  it('preserves edits made during the picker, managed import and save queue', async () => {
    const h = setup();
    h.api.selectLocalImage.mockImplementation(async () => { h.live = { ...h.live, title: '正在编辑的标题' }; return 'C:/source/new.png'; });
    h.api.addImageLabRecord.mockImplementation(async () => { h.shot().motionPrompt = '保留运动提示'; return { kind: 'state-patch', revision: 1, patch: { kind: 'image-lab-upsert', record: { ...h.record, promptPreview: h.record.prompt } } } as AppMutationResult; });
    h.enqueue.mockImplementation(async (_id, update) => { h.shot().title = '排队期间编辑'; h.live = update(h.live); return h.live; });
    await h.run();
    expect(h.live.title).toBe('正在编辑的标题');
    expect(h.shot().motionPrompt).toBe('保留运动提示');
    expect(h.shot().title).toBe('排队期间编辑');
    expect(h.live.episodes[0].scenes[0].shots[1].firstFrameAssetVersionId).toBeUndefined();
  });

  it('does nothing when the native picker is cancelled', async () => {
    const h = setup(); h.api.selectLocalImage.mockResolvedValue(null);
    expect(await h.run()).toBeNull();
    expect(h.api.addImageLabRecord).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it.each(['picker', 'import', 'queue'] as const)('does not bind a cancelled %s operation', async phase => {
    const h = setup();
    if (phase === 'picker') h.api.selectLocalImage.mockImplementation(async () => { h.controller.abort(); return 'C:/source/a.png'; });
    if (phase === 'import') h.api.getImageLabRecordDetail.mockImplementation(async () => { h.controller.abort(); return h.record; });
    if (phase === 'queue') h.enqueue.mockImplementation(async (_id, update) => { h.controller.abort(); return update(h.live); });
    await expect(h.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.shot().firstFrameAssetVersionId).toBeUndefined();
    expect(h.live.assets).toHaveLength(0);
  });

  it.each(['different-project', 'reopened-project', 'deleted-shot'] as const)('rejects stale identity after import: %s', async kind => {
    const h = setup();
    h.api.getImageLabRecordDetail.mockImplementation(async () => {
      if (kind === 'different-project') h.live = { ...h.live, id: 'another-project' };
      if (kind === 'reopened-project') h.invalidate();
      if (kind === 'deleted-shot') h.live.episodes[0].scenes[0].shots = h.live.episodes[0].scenes[0].shots.filter(shot => shot.id !== h.shotId);
      return h.record;
    });
    await expect(h.run()).rejects.toThrow(kind === 'deleted-shot' ? '镜头已删除' : '项目已切换');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('does not overwrite a more recent slot selection', async () => {
    const h = setup();
    h.enqueue.mockImplementation(async (_id, update) => { h.shot().firstFrameAssetVersionId = 'newer-frame'; return update(h.live); });
    await expect(h.run()).rejects.toThrow('未覆盖较新的选择');
    expect(h.shot().firstFrameAssetVersionId).toBe('newer-frame');
  });

  it('surfaces managed import failures without changing the slot', async () => {
    const h = setup(); h.api.addImageLabRecord.mockRejectedValue(new Error('磁盘写入失败'));
    await expect(h.run()).rejects.toThrow('磁盘写入失败');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('rejects ephemeral previews and incomplete records', async () => {
    const h = setup(); h.record.imagePath = 'blob:preview';
    await expect(h.run()).rejects.toThrow('托管导入');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('retains an optimistic imported draft when persistence fails, for retry by existing save', async () => {
    const h = setup(); h.enqueue.mockImplementation(async (_id, update) => { h.live = update(h.live); throw new Error('保存失败'); });
    await expect(h.run()).rejects.toThrow('保存失败');
    expect(h.shot().firstFrameAssetVersionId).toBe('motion-comic-frame-managed-record');
    expect(h.live.assets[0].localPath).toBe('C:/managed/copied.png');
  });

  it('offers generated, imported and previously bound frames but not series references', () => {
    const h = setup();
    const asset = { kind: 'image' as const, localPath: 'C:/managed/a.png', createdAt: now };
    h.live.assets.push(
      { ...asset, id: 'generated', assetId: 'shot-keyframe-a' },
      { ...asset, id: 'imported', assetId: 'shot-frame-a-first' },
      { ...asset, id: 'bound', assetId: 'legacy-import' },
      { ...asset, id: 'reference', assetId: 'motion-comic-reference-character-a' },
      { ...asset, id: 'unrelated', assetId: 'other' },
    );
    h.shot().lastFrameAssetVersionId = 'bound';
    expect(motionComicFrameAssets(h.live).map(asset => asset.id)).toEqual(['generated', 'imported', 'bound']);
  });
});

describe('frame upload controls', () => {
  it('renders keyboard-native upload/replace controls and retains existing selection actions', () => {
    const html = renderToStaticMarkup(createElement(MotionComicFramePanel, {
      firstId: 'existing', previousId: 'existing', options: [{ id: 'existing', label: '已有图片', url: '/managed.png' }], busy: false,
      onSetFirst: vi.fn(), onSetLast: vi.fn(), onUsePrevious: vi.fn(), onImport: vi.fn(),
    }));
    expect(html).toMatch(/<button[^>]+aria-label="替换首帧图片"/);
    expect(html).toMatch(/<button[^>]+aria-label="上传尾帧图片"/);
    expect(html).toContain('使用上一镜头画面作首帧');
    expect(html).toContain('设为尾帧');
    expect(html).toContain('draggable="true"');
  });
});
