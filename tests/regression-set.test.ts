import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REGRESSION_BASELINE_2026_11_10, REGRESSION_TOPICS, compareRegressionRuns, regressionChecklist, summarizeRegressionRun, type RegressionRun,
} from '../src/shared/regression-set';
import { collectRegressionRun } from '../scripts/regression-set';

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

describe('real regression set (Q-6)', () => {
  it('has 2–3 fixed topics per route with unique ids', () => {
    const ids = REGRESSION_TOPICS.map(topic => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of ['lemo', 'template', 'html'] as const) {
      const count = REGRESSION_TOPICS.filter(topic => topic.route === route).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
    for (const film of REGRESSION_BASELINE_2026_11_10.films) expect(ids).toContain(film.topicId);
  });

  it('flags regressions and drift against the previous run', () => {
    const previous: RegressionRun = { id: 'a', date: '2026-11-10', label: '', films: [
      { topicId: 'lemo-blueprint', route: 'lemo', completed: true, gate: 'passed', cost: 4, minutes: 14, durationSeconds: 30 },
      { topicId: 'html-explainer', route: 'html', completed: true, gate: 'warning', cost: 1, minutes: 5 },
    ] };
    const current: RegressionRun = { id: 'b', date: '2026-11-20', label: '', films: [
      { topicId: 'lemo-blueprint', route: 'lemo', completed: true, gate: 'failed', cost: 7, minutes: 15, durationSeconds: 32, integratedLufs: -16.2, truePeak: -0.5, images: 13 },
      { topicId: 'html-explainer', route: 'html', completed: false },
    ] };
    const findings = compareRegressionRuns(previous, current);
    const details = findings.map(finding => `${finding.severity}:${finding.topicId}:${finding.detail}`);
    expect(details).toContain('regression:html-explainer:上次完成，这次未完成');
    expect(details.some(detail => detail.startsWith('regression:lemo-blueprint:质量闸门由 passed 变为 failed'))).toBe(true);
    expect(details.some(detail => detail.includes('响度 -16.2 LUFS'))).toBe(true);
    expect(details.some(detail => detail.includes('真峰值 -0.5'))).toBe(true);
    expect(details.some(detail => detail.startsWith('warning:lemo-blueprint:费用 4 → 7'))).toBe(true);
    expect(details.some(detail => detail.includes('时长 30s → 32s'))).toBe(true);
    expect(details.some(detail => detail.includes('生图 13 张'))).toBe(true);
    expect(details.some(detail => detail.includes('耗时'))).toBe(false);
  });

  it('summarizes per route and prints a budgeted checklist', () => {
    const summary = summarizeRegressionRun(REGRESSION_BASELINE_2026_11_10);
    expect(summary.map(row => [row.route, row.completed, row.films])).toEqual([['lemo', 1, 1], ['template', 1, 1], ['html', 1, 1]]);
    const checklist = regressionChecklist();
    expect(checklist).toContain('整轮预算 60 CNY');
    expect(checklist.split('\n').filter(line => /^\d+\. \[/u.test(line))).toHaveLength(REGRESSION_TOPICS.length);
  });

  it('archives a run directory from films, quality-gate reports and costs.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'regression-run-'));
    roots.push(dir);
    await writeFile(join(dir, 'lemo-blueprint.mp4'), 'x');
    await writeFile(join(dir, 'lemo-blueprint.quality-gate.json'), JSON.stringify({ status: 'warning', probe: { durationSeconds: 30.04 }, loudness: { integratedLufs: -14.2, truePeak: -1.3 } }));
    await mkdir(join(dir, 'html-explainer'));
    await writeFile(join(dir, 'html-explainer', 'final.mp4'), 'x');
    await writeFile(join(dir, 'costs.json'), JSON.stringify({ 'lemo-blueprint': { cost: 4.5, minutes: 14, images: 0 }, 'template-briefing': { cost: 0.8 } }));
    const run = collectRegressionRun(dir, '测试', '2026-11-20');
    expect(run.films.map(film => [film.topicId, film.completed, film.gate ?? null])).toEqual([
      ['lemo-blueprint', true, 'warning'], ['template-briefing', false, null], ['html-explainer', true, null],
    ]);
    expect(run.films[0]).toMatchObject({ durationSeconds: 30.04, integratedLufs: -14.2, cost: 4.5, minutes: 14 });
    expect(compareRegressionRuns(REGRESSION_BASELINE_2026_11_10, run).filter(finding => finding.severity === 'regression').map(finding => finding.topicId)).toEqual(['template-briefing']);
  });
});
