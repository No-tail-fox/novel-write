import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { rejectLedgerLinks } from '../services/lemo-agent-worker/ledger-owner';
import { officialStageHash, readOfficialStageFile, writeOfficialStageJson } from './lemo-official-stages';

export type OfficialScene = { id: string; startMs?: number; durationMs: number };
export const officialScenePath = (id: string) => 'scenes/' + officialStageHash(id).slice(0, 24) + '.mjs';
export function officialScenesManifest(shots: OfficialScene[]) {
  return JSON.stringify({ version: 1, shots: shots.map(s => ({ id: s.id, module: officialScenePath(s.id), startMs: s.startMs, durationMs: s.durationMs })) }, null, 2) + '\n';
}
export async function assertOfficialSceneModules(project: string, manifest: string) {
  if ((await readOfficialStageFile(join(project, 'SCENES.json'))).toString('utf8') !== manifest) throw new Error('LEMO_SCENE_MANIFEST_CHANGED');
  for (const shot of JSON.parse(manifest).shots as Array<{ module: string }>) {
    const bytes = await readOfficialStageFile(join(project, shot.module));
    if (bytes.toString('utf8').trim().length < 20) throw new Error('LEMO_SCENE_MODULE_REQUIRED');
  }
}
const fileSchema = z.object({ path: z.string().min(1).max(512), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }).strict();
const boundarySchema = z.object({ version: z.literal(1), baseProject: z.string(), target: z.string().regex(/^scenes\/[a-f0-9]{24}\.mjs$/), files: z.array(fileSchema).min(1).max(256) }).strict();
async function inventory(root: string) {
  const files: Array<z.infer<typeof fileSchema>> = []; let total = 0;
  async function walk(prefix: string, depth: number) {
    if (depth > 12) throw new Error('LEMO_REPAIR_PROJECT_DEPTH');
    await rejectLedgerLinks(join(root, prefix));
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      if (/[\\:\x00-\x1f]/.test(entry.name) || entry.name === '.' || entry.name === '..') throw new Error('LEMO_REPAIR_PROJECT_PATH');
      const relative = prefix ? prefix + '/' + entry.name : entry.name, path = join(root, relative);
      await rejectLedgerLinks(path); const stat = await lstat(path);
      if (stat.isDirectory()) await walk(relative, depth + 1);
      else {
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024 || (total += stat.size) > 16 * 1024 * 1024 || files.length >= 256) throw new Error('LEMO_REPAIR_PROJECT_FILE');
        const bytes = await readFile(path); files.push({ path: relative, sha256: officialStageHash(bytes), bytes: bytes.length });
      }
    }
  }
  await walk('', 0); return files.sort((a, b) => a.path.localeCompare(b.path));
}
/** Copy once into a child stage; all original sources remain immutable. */
export async function prepareOfficialRepairBoundary(root: string, baseProject: string, target: string, create: boolean) {
  const path = join(root, 'repair-boundary.json'), project = join(root, 'sdk-state', 'project');
  const actual = await inventory(baseProject);
  let boundary: z.infer<typeof boundarySchema>;
  if (existsSync(path)) boundary = boundarySchema.parse(JSON.parse((await readOfficialStageFile(path)).toString('utf8')));
  else {
    if (!create) return;
    if (existsSync(join(root, 'execution-intent.json')) || existsSync(join(root, 'stage', 'stage.json'))) throw new Error('LEMO_REPAIR_BOUNDARY_MISSING');
    boundary = boundarySchema.parse({ version: 1, baseProject, target, files: actual });
    if (!actual.some(f => f.path === target)) throw new Error('LEMO_REPAIR_SCENE_MISSING');
    await writeOfficialStageJson(path, boundary);
  }
  if (boundary.baseProject !== baseProject || boundary.target !== target || JSON.stringify(boundary.files) !== JSON.stringify(actual)) throw new Error('LEMO_REPAIR_BASE_CHANGED');
  const attempted = existsSync(join(root, 'execution-intent.json'));
  if (create && !attempted) {
    for (const f of boundary.files) {
      const destination = join(project, f.path); await rejectLedgerLinks(destination); await mkdir(dirname(destination), { recursive: true });
      const bytes = await readFile(join(baseProject, f.path));
      if (!existsSync(destination)) await writeFile(destination, bytes, { flag: 'wx' });
      else if (officialStageHash(await readOfficialStageFile(destination, 2 * 1024 * 1024)) !== f.sha256) throw new Error('LEMO_REPAIR_COPY_CONFLICT');
    }
  }
  const validate = async (requireChange = false) => {
    const current = await inventory(project);
    if (current.length !== boundary.files.length || current.some((f, i) => f.path !== boundary.files[i].path || f.path !== target && (f.sha256 !== boundary.files[i].sha256 || f.bytes !== boundary.files[i].bytes))) throw new Error('LEMO_REPAIR_OUT_OF_SCOPE');
    if (requireChange && current.find(f => f.path === target)?.sha256 === boundary.files.find(f => f.path === target)?.sha256) throw new Error('LEMO_REPAIR_NO_CHANGE');
    if (JSON.stringify(await inventory(baseProject)) !== JSON.stringify(boundary.files)) throw new Error('LEMO_REPAIR_BASE_CHANGED');
  };
  await validate(); return { project, boundary, validate };
}
