import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLemoAgentActivity } from '../electron/lemo-agent-activity';
import { summarizeLemoAgentTurn, voxProductionStepCount, voxProductionStepTotalLabel } from '../src/shared/lemo-agent-activity';
import type { VoxProductionNode, VoxProductionRun } from '../src/shared/vox-production';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const node = (id: string, kind: VoxProductionNode['kind'], status: VoxProductionNode['status']): VoxProductionNode => ({ id, kind, status, dependencies: [], paid: false, attempt: 0 });
function run(turns: number, completedTurns: number, overrides: Partial<VoxProductionRun> = {}): VoxProductionRun {
  const shots = Array.from({ length: 30 }, (_, i) => [node(`voice:s${i}`, 'voice', 'completed'), node(`timing:s${i}`, 'timing', 'completed')]).flat();
  const agent = Array.from({ length: turns }, (_, i) => ({ ...node(`upstream-turn:${i + 1}`, 'film-edit', i < completedTurns ? 'completed' : 'running'), fileId: String(i + 1) }));
  return { id: 'run-1', status: 'running', authoringVersion: 3, settings: {}, nodes: [...shots, ...agent, node('upstream-ready', 'film-finalize', 'pending'), node('render', 'render', 'pending'), node('verify', 'verify', 'pending')], ...overrides } as unknown as VoxProductionRun;
}

describe('Lemo Agent step bound', () => {
  it('shows the upper bound while turns can still be appended (74/≤127 for 30 shots and 64 turns)', () => {
    const steps = voxProductionStepCount(run(15, 14), { runId: 'run-1', turn: 14, status: 'authoring' });
    expect(steps).toEqual({ completed: 74, total: 78, max: 127 });
    expect(`${steps.completed}/${voxProductionStepTotalLabel(steps)}`).toBe('74/≤127');
  });
  it('respects a custom turn limit and fixes the total once the film is ready, exhausted or the run ended', () => {
    expect(voxProductionStepCount(run(15, 14, { settings: { agentMaxTurns: 20 } } as Partial<VoxProductionRun>), { runId: 'run-1', turn: 14, status: 'authoring' }).max).toBe(83);
    expect(voxProductionStepCount(run(15, 15), { runId: 'run-1', turn: 15, status: 'ready' }).max).toBeUndefined();
    expect(voxProductionStepCount(run(64, 64), { runId: 'run-1', turn: 64, status: 'authoring' }).max).toBeUndefined();
    expect(voxProductionStepCount(run(15, 14, { status: 'completed' }), { runId: 'run-1', turn: 14, status: 'authoring' }).max).toBeUndefined();
    expect(voxProductionStepCount(run(15, 14, { authoringVersion: undefined }), undefined).max).toBeUndefined();
  });
  it('ignores a film that belongs to another run', () => {
    expect(voxProductionStepCount(run(15, 14), { runId: 'old', turn: 9, status: 'ready' }).max).toBe(127);
  });
});

describe('Lemo Agent turn summaries', () => {
  it('summarizes writes, reviews, rejections and finish without file bodies', () => {
    const write = summarizeLemoAgentTurn({ index: 3, tool: 'write_file', reply: '```json\n{"tool":"write_file","path":"scenes/act1.js"}\n```\n```js\nexport const secret = 1;\n```', observation: JSON.stringify({ path: 'scenes/act1.js', bytes: 2048, applied: true }) });
    expect(write).toEqual({ index: 3, tool: 'write_file', ok: true, target: 'scenes/act1.js', detail: '2.0 KB' });
    expect(JSON.stringify(write)).not.toContain('secret');
    const review = summarizeLemoAgentTurn({ index: 4, tool: 'review_frames', reply: '{"tool":"review_frames"}', observation: JSON.stringify({ frames: [{ time: 1, path: 'C:/f/0.png' }, { time: 2, path: 'C:/f/1.png' }], errors: [], missingResources: [], technicalPassed: true, durationMatches: true }) });
    expect(review).toMatchObject({ ok: true, frames: ['C:/f/0.png', 'C:/f/1.png'], technicalPassed: true, detail: '技术检查通过 · 2 帧' });
    const failedReview = summarizeLemoAgentTurn({ index: 5, tool: 'review_frames', reply: '{"tool":"review_frames"}', observation: JSON.stringify({ frames: [], errors: ['boom'], missingResources: [], technicalPassed: false, durationMatches: false }) });
    expect(failedReview.detail).toBe('时长不符 · 1 个运行错误');
    const rejected = summarizeLemoAgentTurn({ index: 6, tool: 'replace_text', reply: '{"tool":"replace_text","path":"a.js","before":"x","after":"y"}', observation: 'Tool rejected; no success claimed: LEMO_AGENT_PATCH_MISMATCH: before text must occur exactly once. Read the file first.. Read actual files and correct the next action.' });
    expect(rejected).toMatchObject({ ok: false, target: 'a.js', detail: 'LEMO_AGENT_PATCH_MISMATCH: before text must occur exactly once. Read the file first.' });
    const invalid = summarizeLemoAgentTurn({ index: 7, tool: 'invalid_reply', reply: '我已确认导演规范要求，下一步读取技术规范。', observation: 'Tool rejected; no success claimed: Unexpected token. Read actual files and correct the next action.' });
    expect(invalid).toMatchObject({ ok: false, tool: 'invalid_reply', detail: '模型回复了文字而不是动作：我已确认导演规范要求，下一步读取技术规范。' });
    const doubled = summarizeLemoAgentTurn({ index: 9, tool: 'invalid_reply', reply: '{"tool":"review_frames"}\n{"tool":"finish","notes":"x"}', observation: 'Tool rejected; no success claimed: Unexpected non-whitespace character after JSON at position 39. Read actual files and correct the next action.' });
    expect(doubled.detail).toBe('动作格式无效：一次回复了多个动作或在动作后附带了文字');
    const finish = summarizeLemoAgentTurn({ index: 8, tool: 'finish', reply: '{"tool":"finish","notes":"三帧构图稳定，字幕区留白充足，没有裁切和穿帮。"}', observation: 'Film sources ready.' });
    expect(finish).toMatchObject({ ok: true, detail: '三帧构图稳定，字幕区留白充足，没有裁切和穿帮。' });
  });
});

describe('readLemoAgentActivity (read-only journal view)', () => {
  it('returns an empty view before the first turn and reports the in-flight turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-activity-')); roots.push(root);
    expect(await readLemoAgentActivity(root, 'run-1')).toEqual({ runId: 'run-1', turns: [], totalTurns: 0 });
    await writeFile(join(root, 'journal.json'), JSON.stringify({ version: 1, turns: [
      { index: 1, tool: 'list_files', reply: '{"tool":"list_files","scope":"library","path":""}', observation: '[]', modelRequestId: null },
      { index: 2, tool: 'read_file', reply: '{"tool":"read_file","scope":"library","path":"DIRECTOR.md"}', observation: '{}', modelRequestId: null },
    ] }));
    await mkdir(join(root, 'turn-0003'), { recursive: true });
    await writeFile(join(root, 'turn-0003', 'submitted.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', index: 3 }));
    const activity = await readLemoAgentActivity(root, 'run-1');
    expect(activity.totalTurns).toBe(2);
    expect(activity.turns.map(turn => [turn.index, turn.tool, turn.target])).toEqual([[1, 'list_files', 'Lemo 库'], [2, 'read_file', 'DIRECTOR.md']]);
    expect(activity.pending).toEqual({ index: 3, phase: 'waiting-model', startedAt: '2026-01-01T00:00:00.000Z' });
    await writeFile(join(root, 'turn-0003', 'response.json'), '{}');
    expect((await readLemoAgentActivity(root, 'run-1')).pending?.phase).toBe('applying');
  });
});
