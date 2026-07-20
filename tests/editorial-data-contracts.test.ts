import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CUSTOM_COVER_TEMPLATE_FIELDS,
  IMAGE_LAB_SMART_MODE_CONTRACT,
  MINIMAX_CLONE_VOICE_FIELDS,
} from '@shared/editorial-data-contracts';
import { ipcInputSchemas } from '@shared/ipc-contract';
import { FileDatabase } from '@shared/storage';
import type {
  CountedCursorPage,
  CustomCoverTemplate,
  ImageLabSmartMode,
  MinimaxCloneVoice,
} from '@shared/types';

describe('editorial data contracts', () => {
  it('keeps independent exhaustive inventories for every governed field', () => {
    expectTypeOf(IMAGE_LAB_SMART_MODE_CONTRACT).toMatchTypeOf<Record<ImageLabSmartMode, unknown>>();
    expectTypeOf(CUSTOM_COVER_TEMPLATE_FIELDS).toMatchTypeOf<{ [K in keyof CustomCoverTemplate]-?: true }>();
    expectTypeOf(MINIMAX_CLONE_VOICE_FIELDS).toMatchTypeOf<{ [K in keyof MinimaxCloneVoice]-?: true }>();

    expect(Object.keys(IMAGE_LAB_SMART_MODE_CONTRACT).sort()).toEqual([
      'blog-cover', 'cover', 'podcast-cover', 'reference-edit', 'text-to-image', 'two-host-podcast', 'video-narration',
    ]);
    expect(Object.keys(CUSTOM_COVER_TEMPLATE_FIELDS).sort()).toEqual([
      'compositionRule', 'createdAt', 'description', 'directions', 'id', 'name', 'plainHint', 'subtitleLayout', 'titleLayout', 'updatedAt',
    ]);
    expect(Object.keys(MINIMAX_CLONE_VOICE_FIELDS).sort()).toEqual([
      'createdAt', 'displayName', 'lastUsedAt', 'sourceAudioPath', 'voiceId',
    ]);
  });

  it('round-trips every representative image, cover, and clone-voice field across reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-editorial-contracts-'));
    const file = join(dir, 'app.db');
    const cover: CustomCoverTemplate = {
      id: 'custom-cover-all-fields',
      name: 'All fields',
      description: 'description',
      directions: 'directions',
      compositionRule: 'composition',
      titleLayout: 'title',
      subtitleLayout: 'subtitle',
      plainHint: 'plain hint',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T01:00:00.000Z',
    };
    const voice: MinimaxCloneVoice = {
      voiceId: 'clone-all-fields',
      displayName: 'Clone all fields',
      sourceAudioPath: 'D:/voices/source.wav',
      createdAt: 101,
      lastUsedAt: 202,
    };
    try {
      const db = await FileDatabase.open(file);
      await db.addImageLabRecord({
        id: 'image-all-fields',
        archivedAt: null,
        managedStorageKey: 'image-all-fields-key',
        prompt: 'full prompt',
        ratio: '4:3',
        style: 'cinematic',
        provider: 'custom',
        imagePath: 'D:/images/result.png',
        status: 'generated',
        errorMessage: '',
        resolution: '4K',
        smartMode: 'reference-edit',
        referenceImagePaths: ['D:/images/ref-a.png', 'D:/images/ref-b.png'],
        referenceImagePath: 'D:/images/ref-a.png',
        upstreamTaskId: 'upstream-task',
        createdAt: '2026-07-20T02:00:00.000Z',
        finishedAt: '2026-07-20T03:00:00.000Z',
      });
      await db.upsertCustomCoverTemplate(cover);
      await db.upsertMinimaxCloneVoice(voice);
      await db.close();

      const reopened = await FileDatabase.open(file);
      expect(await reopened.getImageLabRecordDetail('image-all-fields')).toMatchObject({
        smartMode: 'reference-edit',
        referenceImagePaths: ['D:/images/ref-a.png', 'D:/images/ref-b.png'],
        upstreamTaskId: 'upstream-task',
        resolution: '4K',
      });
      expect(await reopened.getCustomCoverTemplateDetail(cover.id)).toEqual(cover);
      expect((await reopened.listMinimaxCloneVoices({ limit: 10 })).items).toContainEqual(voice);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never overwrites a user-edited default cover on reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-cover-default-preserve-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const original = await db.getCustomCoverTemplateDetail('cinematic-poster');
      expect(original).not.toBeNull();
      await db.upsertCustomCoverTemplate({ ...original!, name: 'User edited name', directions: 'User edited directions' });
      await db.close();

      const reopened = await FileDatabase.open(file);
      expect(await reopened.getCustomCoverTemplateDetail('cinematic-poster')).toMatchObject({
        name: 'User edited name',
        directions: 'User edited directions',
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pages every clone voice with a true total beyond the bounded bootstrap projection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-clone-voice-pages-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      for (let index = 0; index < 101; index += 1) {
        await db.upsertMinimaxCloneVoice({
          voiceId: `voice-${String(index).padStart(3, '0')}`,
          displayName: `Voice ${index}`,
          sourceAudioPath: `D:/voices/${index}.wav`,
          createdAt: index,
          lastUsedAt: 10_000 - index,
        });
      }
      const beforeSave = await db.listMinimaxCloneVoices({ limit: 40 });
      await db.upsertConfig((await db.getState()).config);
      const afterSave = await db.listMinimaxCloneVoices({ limit: 40 });
      expect(afterSave.items.map((voice) => voice.lastUsedAt)).toEqual(beforeSave.items.map((voice) => voice.lastUsedAt));
      await db.close();

      const reopened = await FileDatabase.open(file);
      expect((await reopened.getBootstrapMetadata()).minimaxCloneVoices).toHaveLength(100);
      const collected: MinimaxCloneVoice[] = [];
      let cursor: string | null = null;
      let totalCount = 0;
      do {
        const page: CountedCursorPage<MinimaxCloneVoice> = await reopened.listMinimaxCloneVoices({ cursor, limit: 40 });
        collected.push(...page.items);
        totalCount = page.totalCount;
        cursor = page.nextCursor;
      } while (cursor);
      expect(totalCount).toBe(101);
      expect(collected).toHaveLength(101);
      expect(new Set(collected.map((voice) => voice.voiceId)).size).toBe(101);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts only strict bounded clone-voice cursor requests over IPC', () => {
    const schema = ipcInputSchemas['minimax-clone-voice:list'];
    expect(schema.safeParse({ cursor: null, limit: 100 }).success).toBe(true);
    expect(schema.safeParse({ cursor: null, limit: 100, unknown: true }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
