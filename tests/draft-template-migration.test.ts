import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateState } from '../src/app/app-state';
import { makeFallbackApi } from '../src/app/browser-fallback';
import { builtinDraftTemplateUpdates, reconcileBuiltinDraftTemplates } from '@shared/draft-template-migration';
import { FileDatabase } from '@shared/storage';
import { draftTemplates, legacyDefaultDraftTemplate, normalizeDraftTemplate } from '@shared/templates';
import type { DraftTemplate } from '@shared/types';

const oldTimestamp = '2026-05-26T00:00:00.000Z';
const builtinIds = draftTemplates.map((template) => template.id).sort();

function legacyTemplate(): DraftTemplate {
  return { ...structuredClone(legacyDefaultDraftTemplate), updatedAt: oldTimestamp };
}

function customTemplate(): DraftTemplate {
  return { ...legacyTemplate(), id: 'my-custom-preset', name: '用户自己的模板', isDefault: false };
}

afterEach(() => vi.unstubAllGlobals());

describe('draft template upgrades', () => {
  it('fills every missing built-in in existing state and migrates an untouched legacy default once', () => {
    const legacy = legacyTemplate();
    const custom = customTemplate();
    const stored = [legacy, custom];
    const original = structuredClone(stored);
    const result = reconcileBuiltinDraftTemplates(stored);

    expect(result.map((template) => template.id).sort()).toEqual([...builtinIds, custom.id].sort());
    expect(result.find((template) => template.id === legacy.id)).toEqual(normalizeDraftTemplate(draftTemplates[0]));
    expect(result.find((template) => template.id === custom.id)).toEqual(custom);
    expect(stored).toEqual(original);
    expect(builtinDraftTemplateUpdates(result)).toEqual([]);
    expect(reconcileBuiltinDraftTemplates(result)).toEqual(result);
    expect(hydrateState({ draftTemplates: stored }).draftTemplates).toEqual(result);
  });

  it('ignores property order when matching the historical preset', () => {
    const legacy = Object.fromEntries(Object.entries(legacyTemplate()).reverse()) as DraftTemplate;
    legacy.title = Object.fromEntries(Object.entries(legacy.title).reverse()) as DraftTemplate['title'];
    expect(builtinDraftTemplateUpdates([legacy]).some((template) => template.id === legacy.id)).toBe(true);
  });

  it.each([
    ['name', (template: DraftTemplate) => { template.name = '我的默认模板'; }],
    ['title position', (template: DraftTemplate) => { template.title.y += 0.01; }],
    ['caption styling', (template: DraftTemplate) => { template.caption.color = '#112233'; }],
    ['subtitle copy', (template: DraftTemplate) => { template.subtitle.text = '自己的文案'; }],
    ['audio settings', (template: DraftTemplate) => { template.audio.bgmVolume = 2; }],
    ['ownership', (template: DraftTemplate) => { template.isDefault = false; }],
  ] as const)('preserves a legacy default with edited %s', (_label, edit) => {
    const edited = legacyTemplate();
    edit(edited);
    const result = reconcileBuiltinDraftTemplates([edited]);
    expect(result.find((template) => template.id === edited.id)).toEqual(edited);
    expect(builtinDraftTemplateUpdates(result)).toEqual([]);
  });

  it('does not assume incomplete or extended saved data is an untouched preset', () => {
    const incomplete = legacyTemplate() as Partial<DraftTemplate>;
    delete incomplete.audio;
    const extended = { ...legacyTemplate(), userNote: 'keep this saved version' };
    expect(builtinDraftTemplateUpdates([incomplete]).some((template) => template.id === incomplete.id)).toBe(false);
    expect(builtinDraftTemplateUpdates([extended]).some((template) => template.id === extended.id)).toBe(false);
  });

  it.each([false, true])('upgrades an existing SQLite database while preserving user data (default edited: %s)', async (edited) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-draft-presets-upgrade-'));
    const file = join(dir, 'app.db');
    let db: FileDatabase | undefined;
    try {
      db = await FileDatabase.open(file);
      await db.close();
      db = undefined;
      const legacy = legacyTemplate();
      if (edited) legacy.caption.fontSize += 1;
      const custom = customTemplate();
      const existingBuiltin = { ...structuredClone(draftTemplates[1]), name: '已编辑的内置模板', updatedAt: oldTimestamp };
      const SQL = await initSqlJs();
      const sqlite = new SQL.Database(await readFile(file));
      sqlite.run('DELETE FROM draft_templates');
      for (const template of [legacy, custom, existingBuiltin]) {
        sqlite.run('INSERT INTO draft_templates (id, data, is_builtin, name, canvas_width, canvas_height, canvas_ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          template.id, JSON.stringify(template), template.isDefault ? 1 : 0, template.name,
          template.canvas.width, template.canvas.height, template.canvas.ratio, oldTimestamp,
        ]);
      }
      const bytes = sqlite.export();
      sqlite.close();
      await writeFile(file, bytes);

      db = await FileDatabase.open(file);
      const state = await db.getState();
      expect(state.draftTemplates.map((template) => template.id).sort()).toEqual([...builtinIds, custom.id].sort());
      expect(state.draftTemplates.find((template) => template.id === custom.id)).toEqual(custom);
      expect(state.draftTemplates.find((template) => template.id === existingBuiltin.id)).toEqual(existingBuiltin);
      const upgradedDefault = state.draftTemplates.find((template) => template.id === legacy.id)!;
      if (edited) {
        expect(upgradedDefault).toEqual(legacy);
      } else {
        expect(upgradedDefault).toEqual({ ...normalizeDraftTemplate(draftTemplates[0]), updatedAt: upgradedDefault.updatedAt });
        expect(upgradedDefault.updatedAt).not.toBe(oldTimestamp);
      }
      const summaries = await db.listDraftTemplateSummaries({ limit: 100 });
      expect(summaries.items.map((template) => template.id).sort()).toEqual([...builtinIds, custom.id].sort());
      expect(summaries.items.find((template) => template.id === legacy.id)?.name).toBe(upgradedDefault.name);
      await db.close();
      db = await FileDatabase.open(file);
      expect((await db.getState()).draftTemplates).toEqual(state.draftTemplates);
    } finally {
      await db?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('upgrades browser fallback reads and keeps saved edits after the API is recreated', async () => {
    const values = new Map<string, string>([
      ['storydream-state', JSON.stringify({ draftTemplates: [legacyTemplate(), customTemplate()] })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const api = makeFallbackApi(() => undefined);
    const upgraded = await api.getDraftTemplateDetail(legacyDefaultDraftTemplate.id);
    expect(upgraded).toEqual(normalizeDraftTemplate(draftTemplates[0]));
    const edited = { ...upgraded!, title: { ...upgraded!.title, text: '我的标题' } };
    await api.saveDraftTemplate(edited);

    const restarted = makeFallbackApi(() => undefined);
    expect(await restarted.getDraftTemplateDetail(edited.id)).toEqual(edited);
    expect(await restarted.getDraftTemplateDetail(customTemplate().id)).toEqual(customTemplate());
    const list = await restarted.listDraftTemplates({ limit: 100 });
    expect(list.items.map((template) => template.id).sort()).toEqual([...builtinIds, customTemplate().id].sort());
  });
});
