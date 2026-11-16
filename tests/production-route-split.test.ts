import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { parseEditorialCollagePipelineData } from '@shared/editorial-collage';
import { editorialProductionRoute, editorialProductionRouteFromPipelineData, taskProductionRoute } from '@shared/creative-animation/production-route';
import { listVoxProductionProjects } from '../electron/vox-production-projects';
import { taskHistoryTypeLabel } from '../src/features/tasks/task-formatters';
import { navigationItemForView, productionNavItems, taskWorkspaceView } from '../src/app/navigation';

describe('创意动画 / 模板动画 split', () => {
  it('classifies projects by their persisted production settings', () => {
    expect(editorialProductionRoute({ authoring: { mode: 'ai-code' } })).toBe('lemo');
    expect(editorialProductionRoute({ authoring: { mode: 'existing-assets' } })).toBe('lemo');
    expect(editorialProductionRoute({ authoring: { mode: 'template' } })).toBe('template');
    // Pre-Lemo Vox projects (deterministic layers + Remotion shots) are template projects.
    expect(editorialProductionRoute({})).toBe('template');
    expect(editorialProductionRoute(undefined)).toBe('template');
    expect(editorialProductionRouteFromPipelineData('{"beats":[]}')).toBe('template');
    expect(editorialProductionRouteFromPipelineData('not json')).toBe('template');
    expect(taskProductionRoute({ taskType: 'editorial-collage', taskKind: 'music-mv', productionRoute: 'template' })).toBe('lemo');
    expect(taskProductionRoute({ taskType: 'html-video' })).toBeUndefined();
  });

  it('opens each route on its own page with its own navigation entry', () => {
    expect(taskWorkspaceView('editorial-collage', 'lemo')).toBe('editorial-collage');
    expect(taskWorkspaceView('editorial-collage', 'template')).toBe('template-animation');
    expect(taskWorkspaceView('html-video')).toBe('html-video');
    expect(productionNavItems.map(item => item.label)).toEqual(expect.arrayContaining(['创意动画', '模板动画', 'HTML 动画']));
    expect(navigationItemForView('template-animation').label).toBe('模板动画');
  });

  it('keeps old and new projects of both routes listable, openable and recoverable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'route-split-'));
    const file = join(dir, 'storydream.db');
    let db = await FileDatabase.open(file);
    try {
      const lemo = await db.createEditorialCollageTask({ title: 'Lemo', sourceText: '第一段。第二段。', durationMs: 15000, productionRoute: 'lemo' });
      const template = await db.createEditorialCollageTask({ title: 'Template', sourceText: '第一段。第二段。', durationMs: 15000, productionRoute: 'template' });
      const legacy = await db.createEditorialCollageTask({ title: 'Legacy Vox', sourceText: '第一段。第二段。', durationMs: 15000 });
      expect(parseEditorialCollagePipelineData(lemo.pipelineData).productionSettings).toMatchObject({ authoring: { mode: 'ai-code', styleId: 'auto' }, codeVideo: { targetDurationSeconds: 60, captionMode: 'film' }, piMaxRequests: 120 });
      expect(parseEditorialCollagePipelineData(template.pipelineData).productionSettings?.authoring).toMatchObject({ mode: 'template' });
      expect(parseEditorialCollagePipelineData(legacy.pipelineData).productionSettings).toBeUndefined();
      // Old template-mode projects saved before the split.
      const legacyDoc = parseEditorialCollagePipelineData(legacy.pipelineData);
      await db.close();
      db = await FileDatabase.open(file);
      const ids = async (taskType: 'editorial-collage' | 'template-animation') => (await db.listTaskSummaries({ taskType })).items.map(t => t.id).sort();
      expect(await ids('editorial-collage')).toEqual([lemo.id]);
      expect(await ids('template-animation')).toEqual([template.id, legacy.id].sort());
      const summaries = new Map((await db.listTaskSummaries()).items.map(t => [t.id, t]));
      expect(summaries.get(lemo.id)?.productionRoute).toBe('lemo');
      expect(summaries.get(template.id)?.productionRoute).toBe('template');
      expect(summaries.get(legacy.id)?.productionRoute).toBe('template');
      expect(taskHistoryTypeLabel(summaries.get(template.id)!)).toBe('模板动画');
      expect(taskHistoryTypeLabel(summaries.get(lemo.id)!)).toBe('创意动画');
      expect((await db.getTaskDetail(legacy.id))?.productionRoute).toBe('template');
      expect(legacyDoc.beats.length).toBeGreaterThan(0);
      expect((await listVoxProductionProjects(db)).sort()).toEqual([lemo.id, template.id, legacy.id].sort());
      // The route is the project type: switching it on save is refused, other settings stay editable.
      const templateDoc = parseEditorialCollagePipelineData((await db.getTaskDetail(template.id))!.pipelineData);
      const switched = { ...templateDoc, productionSettings: { ...templateDoc.productionSettings!, authoring: { mode: 'ai-code' as const, styleId: 'auto' } } };
      await expect(db.saveEditorialCollageTask({ id: template.id, expectedUpdatedAt: templateDoc.updatedAt, document: switched })).rejects.toThrow('EDITORIAL_ROUTE_LOCKED');
      const restyled = { ...templateDoc, productionSettings: { ...templateDoc.productionSettings!, authoring: { mode: 'template' as const, styleId: 'halftone-dossier' } } };
      await expect(db.saveEditorialCollageTask({ id: template.id, expectedUpdatedAt: templateDoc.updatedAt, document: restyled })).resolves.toBeTruthy();
      // A database written by a build without the route column/triggers is backfilled on open.
      const raw = (db as unknown as { db: { run(sql: string): void; exec(sql: string): Array<{ values: unknown[][] }> } }).db;
      raw.run("DROP TRIGGER IF EXISTS tasks_production_route_insert_v1"); raw.run("DROP TRIGGER IF EXISTS tasks_production_route_update_v1");
      raw.run('UPDATE tasks SET production_route = NULL');
      (db as unknown as { ensureProductionRouteTriggers(): void }).ensureProductionRouteTriggers();
      const routes = Object.fromEntries(raw.exec('SELECT id, production_route FROM tasks')[0].values.map(([id, route]) => [id, route]));
      expect(routes).toEqual({ [lemo.id]: 'lemo', [template.id]: 'template', [legacy.id]: 'template' });
      expect(raw.exec("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'tasks_production_route_%'")[0].values[0][0]).toBe(2);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it('removes the production-mode switch from the creative settings form', async () => {
    const fields = await readFile('src/features/editorial-collage/CreativeProductionFields.tsx', 'utf8');
    expect(fields).not.toContain('label="制作方式"');
    const routes = await readFile('src/app/AppRoutes.tsx', 'utf8');
    expect(routes).toContain("route={activeView === 'template-animation' ? 'template' : 'lemo'}");
  });

  it('opens a requested project exactly once and hands other-route projects over with the request kept', async () => {
    const page = await readFile('src/features/editorial-collage/EditorialCollagePage.tsx', 'utf8');
    // Live regression: the shell recreates `navigate` each render; an effect keyed on it reopened the project while the
    // first open still held the busy action, leaving both 创意动画 and 模板动画 projects on the recovery screen.
    expect(page).toContain('handledRequestRef.current === requestedTaskId');
    expect(page).not.toMatch(/\}, \[navigate, onRequestedTaskHandled, openProject, requestedTaskId\]\)/);
    expect(page).toContain('handOffProject(redirect, requestedTaskId)');
    const app = await readFile('src/app/App.tsx', 'utf8');
    // Plain navigate() clears requestedEditorialCollageTaskId; the hand-off must set it together with the view.
    expect(app).toMatch(/function openEditorialProjectInView[\s\S]{0,300}setRequestedEditorialCollageTaskId\(taskId\);\s*setActiveView\(view\);/);
    const routes = await readFile('src/app/AppRoutes.tsx', 'utf8');
    expect(routes).toContain('openProjectInView={openEditorialProjectInView}');
  });
});
