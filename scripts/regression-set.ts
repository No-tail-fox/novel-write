/**
 * Q-6 real regression set, manual and offline.
 *   tsx scripts/regression-set.ts checklist           → print the fixed topics + budget before a paid run
 *   tsx scripts/regression-set.ts archive <dir> [--label text] [--previous <report.json>]
 *     <dir> holds the run's films, each `<topicId>.mp4` with an optional sibling `quality-gate.json`
 *     (`<topicId>/final.mp4` + `<topicId>/quality-gate.json` also works) and optional `costs.json`
 *     `{ "<topicId>": { "cost": 3.2, "minutes": 14, "images": 6, "tokens": 120000, "repairs": 1 } }`.
 *     Writes `<dir>/regression-report.json` and compares with --previous (default: the 2026-11-10 baseline).
 * It never calls a provider.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  REGRESSION_BASELINE_2026_11_10, REGRESSION_TOPICS, compareRegressionRuns, regressionChecklist, summarizeRegressionRun,
  type RegressionFilmResult, type RegressionRun,
} from '../src/shared/regression-set';

interface GateReport { status?: string; probe?: { durationSeconds?: number | null } | null; loudness?: { integratedLufs?: number | null; truePeak?: number | null } | null }

const readJson = <T>(path: string): T | null => { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; } };

export function collectRegressionRun(dir: string, label: string, date = new Date().toISOString().slice(0, 10)): RegressionRun {
  const costs = readJson<Record<string, Partial<RegressionFilmResult>>>(join(dir, 'costs.json')) ?? {};
  const films: RegressionFilmResult[] = [];
  for (const topic of REGRESSION_TOPICS) {
    const flat = join(dir, `${topic.id}.mp4`);
    const nested = join(dir, topic.id, 'final.mp4');
    const film = existsSync(flat) ? flat : existsSync(nested) ? nested : null;
    const extra = costs[topic.id] ?? {};
    if (!film && !costs[topic.id]) continue; // topic not part of this run
    const gate = film ? readJson<GateReport>(existsSync(flat) ? join(dir, `${topic.id}.quality-gate.json`) : join(dir, topic.id, 'quality-gate.json')) : null;
    films.push({
      topicId: topic.id,
      route: topic.route,
      completed: Boolean(film),
      gate: gate?.status === 'passed' || gate?.status === 'warning' || gate?.status === 'failed' || gate?.status === 'error' ? gate.status : undefined,
      durationSeconds: gate?.probe?.durationSeconds ?? undefined,
      integratedLufs: gate?.loudness?.integratedLufs ?? undefined,
      truePeak: gate?.loudness?.truePeak ?? undefined,
      cost: extra.cost, minutes: extra.minutes, images: extra.images, tokens: extra.tokens, repairs: extra.repairs,
    });
  }
  return { id: basename(resolve(dir)), date, label, films };
}

function main(argv: string[]) {
  const [command, dir] = argv;
  if (command === 'checklist' || !command) { console.log(regressionChecklist()); return 0; }
  if (command !== 'archive' || !dir) { console.error('用法：regression-set.ts checklist | archive <目录> [--label 文本] [--previous report.json]'); return 2; }
  const option = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const run = collectRegressionRun(dir, option('--label') ?? '');
  const previousPath = option('--previous');
  const previous = previousPath ? readJson<{ run: RegressionRun }>(previousPath)?.run ?? null : REGRESSION_BASELINE_2026_11_10;
  if (!previous) { console.error(`读不到上次报告：${previousPath}`); return 2; }
  const findings = compareRegressionRuns(previous, run);
  const report = { kind: 'storydream-regression-report', run, summary: summarizeRegressionRun(run), comparedWith: previous.id, findings };
  writeFileSync(join(dir, 'regression-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.summary) console.log(`[${row.route}] 完成 ${row.completed}/${row.films}，闸门通过 ${row.gatePassed}，费用 ${row.cost}，耗时 ${row.minutes} 分钟`);
  for (const finding of findings) console.log(`${finding.severity === 'regression' ? '回退' : '注意'} ${finding.topicId}：${finding.detail}`);
  console.log(findings.some(finding => finding.severity === 'regression') ? '发现回退' : '未发现回退');
  return findings.some(finding => finding.severity === 'regression') ? 1 : 0;
}

if (process.argv[1] && /regression-set\.ts$/u.test(process.argv[1])) process.exitCode = main(process.argv.slice(2));
