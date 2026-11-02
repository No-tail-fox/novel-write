import { afterEach, describe, expect, it } from 'vitest';
import { link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertOfficialSceneModules, officialScenePath, officialScenesManifest, prepareOfficialRepairBoundary } from '../electron/lemo-official-repair';
import { voxProductionControlSchema } from '../src/shared/vox-production';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const temp = resolve('.artifacts/lemo-repair-unit'); await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, 'repair-')); roots.push(root);
  const source = join(root, 'source'), target = officialScenePath('shot-a'), other = officialScenePath('shot-b'), stage = join(root, 'stage');
  const manifest = officialScenesManifest([{ id: 'shot-a', startMs: 0, durationMs: 3000 }, { id: 'shot-b', startMs: 3000, durationMs: 3000 }]);
  for (const [path, body] of [['index.html', '<html>immutable routing</html>'], ['SCENES.json', manifest], [target, 'export const draw = () => "first original scene";'], [other, 'export const draw = () => "second original scene";'], ['MATERIALS.json', '[]']]) {
    await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), body, 'utf8');
  }
  return { root, source, target, other, stage, manifest };
}
describe('official single-scene source boundary', () => {
  it('copies a verified source and accepts only the selected existing module changing', async () => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await expect(repair.validate(true)).rejects.toThrow('LEMO_REPAIR_NO_CHANGE');
    const original = await readFile(join(f.source, f.target));
    await writeFile(join(repair.project, f.target), 'export const draw = () => "changed selected scene";', 'utf8');
    await expect(repair.validate(true)).resolves.toBeUndefined();
    expect(await readFile(join(f.source, f.target))).toEqual(original);
    expect(await readFile(join(repair.project, 'index.html'))).toEqual(await readFile(join(f.source, 'index.html')));
  });
  it.each(['index.html', 'MATERIALS.json', 'SCENES.json', 'other'])('rejects a mutation of frozen %s', async changed => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await writeFile(join(repair.project, changed === 'other' ? f.other : changed), 'out of scope', 'utf8');
    await expect(repair.validate()).rejects.toThrow('LEMO_REPAIR_OUT_OF_SCOPE');
  });
  it.each(['add', 'delete'])('rejects a file %s even when the chosen module also changes', async action => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    if (action === 'add') await writeFile(join(repair.project, 'extra.mjs'), 'export const unauthorized = true;', 'utf8');
    else await unlink(join(repair.project, f.other));
    await expect(repair.validate()).rejects.toThrow('LEMO_REPAIR_OUT_OF_SCOPE');
  });
  it('blocks changes to the original source instead of accepting a new baseline', async () => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await writeFile(join(f.source, f.target), 'changed original', 'utf8');
    await expect(repair.validate()).rejects.toThrow('LEMO_REPAIR_BASE_CHANGED');
    await expect(prepareOfficialRepairBoundary(f.stage, f.source, f.target, true)).rejects.toThrow('LEMO_REPAIR_BASE_CHANGED');
  });
  it('does not recreate a lost boundary after an attempted stage', async () => {
    const f = await fixture(); await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true);
    await writeFile(join(f.stage, 'execution-intent.json'), '{}', 'utf8'); await unlink(join(f.stage, 'repair-boundary.json'));
    await expect(prepareOfficialRepairBoundary(f.stage, f.source, f.target, true)).rejects.toThrow('LEMO_REPAIR_BOUNDARY_MISSING');
    await expect(readFile(join(f.stage, 'repair-boundary.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves an attempted selected edit on resume and validates it without resetting files', async () => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await writeFile(join(f.stage, 'execution-intent.json'), '{}', 'utf8'); await writeFile(join(repair.project, f.target), 'export const resumed = "kept selected source";', 'utf8');
    const resumed = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await expect(resumed.validate(true)).resolves.toBeUndefined(); expect(await readFile(join(resumed.project, f.target), 'utf8')).toContain('kept selected source');
  });
  it('rejects hardlinks in source or copied files before acceptance', async () => {
    const f = await fixture(), repair = (await prepareOfficialRepairBoundary(f.stage, f.source, f.target, true))!;
    await link(join(repair.project, f.target), join(f.root, 'alias'));
    await expect(repair.validate()).rejects.toThrow('LEMO_REPAIR_PROJECT_FILE');
  });
  it('requires the exact immutable scene manifest and actual scene source files', async () => {
    const f = await fixture(); await expect(assertOfficialSceneModules(f.source, f.manifest)).resolves.toBeUndefined();
    await unlink(join(f.source, f.other)); await expect(assertOfficialSceneModules(f.source, f.manifest)).rejects.toThrow();
    await writeFile(join(f.source, 'SCENES.json'), '{}', 'utf8'); await expect(assertOfficialSceneModules(f.source, f.manifest)).rejects.toThrow('LEMO_SCENE_MANIFEST_CHANGED');
  });
  it('requires an explicit selected shot and concrete instructions', () => {
    const action = { id: 'doc', runId: 'run', action: 'repair-shot' };
    expect(voxProductionControlSchema.safeParse(action).success).toBe(false);
    expect(voxProductionControlSchema.safeParse({ ...action, shotId: 'shot-a', instructions: 'repair' }).success).toBe(false);
    expect(voxProductionControlSchema.parse({ ...action, shotId: 'shot-a', instructions: 'Make the selected object larger.' })).toMatchObject({ shotId: 'shot-a' });
  });
});
