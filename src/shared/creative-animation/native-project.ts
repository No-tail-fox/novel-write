import { z } from 'zod';
import { lemoResponseTextSchema } from './creative-text';

import { lemoMaterialSchema } from './native-material';
export { lemoMaterialSchema, type LemoMaterial } from './native-material';
import { lemoPlanningSchema } from './native-planning';
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const lemoFileSchema = z.object({
  id: key, kind: z.enum(['shared', 'scene', 'director']), shotIds: z.array(z.string().max(256)).max(500),
  source: z.string().max(90000).default(''), status: z.enum(['pending', 'valid', 'invalid']).default('pending'),
  attempts: z.array(z.object({ requestId: z.string().max(256), source: z.string().max(90000),
    providerRequestId: z.string().max(512).nullable().optional(), finishReason: z.string().max(200).nullable().optional(),
    editNodeId: z.string().max(256).optional(), rawResponse: lemoResponseTextSchema.optional(), applied: z.boolean().optional(), summary: lemoResponseTextSchema.optional(),
    usage: z.record(z.string(), z.unknown()).optional(), interrupted: z.boolean().optional(), error: z.string().max(8000).optional(),
    reusedFromRequestId: z.string().max(256).optional(),
  }).strict()).max(12).default([]),
}).strict();
export type LemoProjectFile = z.infer<typeof lemoFileSchema>;
export const lemoProjectSchema = z.object({
  version: z.literal(2), planning: lemoPlanningSchema.optional(), authoringMode: z.literal('incremental').optional(),
  editSessions: z.record(z.string().max(256), z.object({
    revision: z.number().int().min(0).max(64).optional(),
    history: z.array(z.object({ revision: z.number().int().min(0), rounds: z.number().int().min(0).max(16), done: z.boolean(),
      receipts: z.array(z.object({ nodeId: z.string().max(256), requestId: z.string().max(256).optional(), inputHash: z.string().max(256).optional() }).strict()).max(16),
    }).strict()).max(64).optional(), rounds: z.number().int().min(0).max(16), done: z.boolean(), diagnostic: z.string().max(8000).optional() }).strict()).refine(s => Object.keys(s).length <= 134).optional(),
  materials: z.array(lemoMaterialSchema).max(24),
  bindings: z.record(z.string(), z.string()).default({}), files: z.array(lemoFileSchema).min(3).max(66),
  repairFileIds: z.array(key).max(66).default([]), samplePaths: z.array(z.string().max(2000)).max(100).default([]),
  diagnostic: z.string().max(8000).optional(),
}).strict();
export type LemoProject = z.infer<typeof lemoProjectSchema>;

/** Authoring units share one clock and may overlap visually. They are never standalone clips. */
export function lemoProjectFiles(shotIds: readonly string[]): LemoProjectFile[] {
  const scenes: LemoProjectFile[] = [];
  for (let i = 0; i < shotIds.length; i += 8) scenes.push({ id: 'scene-' + (scenes.length + 1), kind: 'scene', shotIds: shotIds.slice(i, i + 8), source: '', status: 'pending', attempts: [] });
  return [{ id: 'shared', kind: 'shared', shotIds: [], source: '', status: 'pending', attempts: [] }, ...scenes,
    { id: 'director', kind: 'director', shotIds: [], source: '', status: 'pending', attempts: [] }];
}

/** Immutable timing/content data is supplied by the host, never retyped by the model. */
export function assembleLemoProject(project: LemoProject, input: unknown, durationMs: number, sample = false): string {
  const files = sample ? project.files.filter(f => f.kind === 'shared' || f.id === project.files.find(f => f.kind === 'scene')?.id) : project.files;
  if (files.some(f => f.status !== 'valid' || !f.source.trim())) throw new Error('LEMO_PROJECT_INCOMPLETE: 创作文件尚未通过完整性检查。');
  if (!sample && project.files.reduce((n, f) => n + f.source.length, 0) > 420000) throw new Error('LEMO_PROJECT_SIZE: 影片工程超过总源码预算，请精简公共代码。');
  const safeJson = JSON.stringify(input).replace(/</g, '\\u003c');
  // Each source is a factory body. No intermediate unit owns the host playback protocol.
  const factories = files.map(f => {
    const target = f.kind === 'shared' ? 'shared' : f.kind === 'director' ? 'director' : 'scenes[' + JSON.stringify(f.id) + ']';
    return target + '=await (async function(input,shared,scenes,core,THREE){\n' + f.source.replace(/<\/script/gi, '<\\/script') + '\n})(input,shared,scenes,core,THREE);\n' +
      'if(!' + target + ' || typeof ' + target + '!=="object") throw Error("LEMO_FILE_CONTRACT: ' + f.id + ' must return an object");' +
      (f.kind !== 'shared' ? 'if(typeof ' + target + '.render!=="function" || typeof ' + target + '.texts!=="function") throw Error("LEMO_FILE_CONTRACT: ' + f.id + ' needs render and texts");' : '') + 'await ' + target + '.ready;';
  }).join('\n');
  const first = project.files.find(f => f.kind === 'scene')?.id;
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">\n' +
    'import * as core from "./core/lib.js"; import * as THREE from "three";\n' +
    'const input=' + safeJson + '; input.assets=window.LEMO_ASSETS;\n' +
    'const canvas=document.createElement("canvas"); canvas.width=input.canvas?.width??1920; canvas.height=input.canvas?.height??1080; canvas.dataset.lemoStage="true"; Object.assign(canvas.style,{position:"absolute",inset:"0",width:"100%",height:"100%"}); document.body.style.margin="0"; document.body.style.overflow="hidden"; document.body.appendChild(canvas); input.canvas=canvas;\n' +
    'let shared,director; const scenes=Object.create(null);\n' + factories + '\n' +
    (sample ? 'director=scenes[' + JSON.stringify(first) + '];\n' : '') +
    'await shared.ready; await Promise.all(Object.values(scenes).map(s=>s.ready)); await director.ready; await document.fonts.ready;\n' +
    'window.DUR=' + durationMs / 1000 + '; window.render=t=>director.render(t); window.TEXTS=t=>director.texts(t); window.READY=true;\n' +
    '</script></body></html>';
}

/** Revision zero retains IDs from pre-revision checkpoints. */
export function lemoEditNodeId(session: string, revision: number | undefined, round: number): string {
  return session + (revision ? ':revision:' + revision : '') + ':edit:' + round;
}
