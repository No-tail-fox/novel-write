/**
 * Q-6: real regression set (真实回归集).
 *
 * A fixed, small catalogue of topics per route, run by hand with a budget whenever the model, prompts
 * or dependencies change. Nothing here starts a generation: the app runs the topics (paid), the
 * archive step records each film's quality gate + cost, and `compareRegressionRuns` flags drift
 * against the previous archive. The 2026-11-10 real-route QA run is the first baseline.
 */
export type RegressionRoute = 'lemo' | 'template' | 'html';

export interface RegressionTopic {
  id: string;
  route: RegressionRoute;
  title: string;
  /** Source text pasted into the create form. */
  source: string;
  ratio: '16:9' | '9:16';
  /** Target film length; the gate compares against the film's own planned duration. */
  targetSeconds: number;
  style?: string;
}

export interface RegressionBudget {
  /** Hard stop for a whole run (all topics), in the user's currency. */
  maxCost: number;
  currency: 'CNY' | 'USD';
  maxImagesPerFilm: number;
  maxMinutesPerFilm: number;
}

export interface RegressionFilmResult {
  topicId: string;
  route: RegressionRoute;
  completed: boolean;
  /** Final quality gate status (E-5): passed | warning | failed | error. */
  gate?: 'passed' | 'warning' | 'failed' | 'error';
  durationSeconds?: number;
  integratedLufs?: number | null;
  truePeak?: number | null;
  minutes?: number;
  cost?: number;
  repairs?: number;
  images?: number;
  tokens?: number;
}

export interface RegressionRun {
  id: string;
  /** ISO date of the run. */
  date: string;
  /** Free text: models, app version, prompt revision. */
  label: string;
  films: RegressionFilmResult[];
}

export const REGRESSION_BUDGET: RegressionBudget = { maxCost: 60, currency: 'CNY', maxImagesPerFilm: 12, maxMinutesPerFilm: 30 };

/** Two or three fixed topics per route. Keep ids stable: comparisons key on them. */
export const REGRESSION_TOPICS: readonly RegressionTopic[] = Object.freeze([
  { id: 'lemo-blueprint', route: 'lemo', title: '蓝图里的城市', source: '一座城市从一张蓝图开始：街道、桥梁和灯光一笔一笔被画出来，最后整座城市在夜色中亮起。', ratio: '16:9', targetSeconds: 30, style: 'blueprint' },
  { id: 'lemo-paper', route: 'lemo', title: '纸上的四季', source: '一张白纸折出春天的花、夏天的船、秋天的叶和冬天的雪人。', ratio: '9:16', targetSeconds: 20 },
  { id: 'template-briefing', route: 'template', title: '一周要闻简报', source: '本周三条要闻：新能源车销量创新高；城市地铁新线开通；暑期旅游预订量同比增长。', ratio: '16:9', targetSeconds: 30 },
  { id: 'template-knowledge', route: 'template', title: '为什么天空是蓝色的', source: '阳光由不同颜色的光组成，蓝光波长短，更容易被空气分子散射，所以我们看到的天空是蓝色的。', ratio: '9:16', targetSeconds: 25 },
  { id: 'html-explainer', route: 'html', title: '复利的力量', source: '每天进步百分之一，一年后是原来的 37 倍；每天退步百分之一，一年后只剩 0.03。', ratio: '9:16', targetSeconds: 30 },
  { id: 'html-history', route: 'html', title: '活字印刷简史', source: '毕昇发明泥活字，元代王祯改进木活字，十五世纪古腾堡的金属活字让书籍走进千家万户。', ratio: '16:9', targetSeconds: 35 },
]);

/** First baseline: the 2026-11-10 real-route QA run (one film per route; cost not recorded then). */
export const REGRESSION_BASELINE_2026_11_10: RegressionRun = {
  id: 'run-20261110-102155',
  date: '2026-11-10',
  label: '首版基线：真实路线 QA（创意 o98 / 模板 briefing-board / HTML），默认模型',
  films: [
    { topicId: 'lemo-blueprint', route: 'lemo', completed: true },
    { topicId: 'template-briefing', route: 'template', completed: true },
    { topicId: 'html-explainer', route: 'html', completed: true },
  ],
};

export interface RegressionRouteSummary { route: RegressionRoute; films: number; completed: number; gatePassed: number; completionRate: number; cost: number; minutes: number }

export function summarizeRegressionRun(run: RegressionRun): RegressionRouteSummary[] {
  return (['lemo', 'template', 'html'] as const).map(route => {
    const films = run.films.filter(film => film.route === route);
    const completed = films.filter(film => film.completed).length;
    return {
      route,
      films: films.length,
      completed,
      gatePassed: films.filter(film => film.gate === 'passed' || film.gate === 'warning').length,
      completionRate: films.length ? completed / films.length : 0,
      cost: films.reduce((sum, film) => sum + (film.cost ?? 0), 0),
      minutes: films.reduce((sum, film) => sum + (film.minutes ?? 0), 0),
    };
  });
}

export interface RegressionFinding { topicId: string; severity: 'regression' | 'warning'; detail: string }

/**
 * Compare a run with the previous archive. Regressions: a topic that completed before and fails now,
 * a gate that passed before and fails now, loudness off −14±1 LUFS. Warnings: cost or time up >50%,
 * duration drift >1 s, over-budget images.
 */
export function compareRegressionRuns(previous: RegressionRun, current: RegressionRun, budget: RegressionBudget = REGRESSION_BUDGET): RegressionFinding[] {
  const findings: RegressionFinding[] = [];
  const before = new Map(previous.films.map(film => [film.topicId, film]));
  for (const film of current.films) {
    const old = before.get(film.topicId);
    if (old?.completed && !film.completed) findings.push({ topicId: film.topicId, severity: 'regression', detail: '上次完成，这次未完成' });
    if ((old?.gate === 'passed' || old?.gate === 'warning') && (film.gate === 'failed' || film.gate === 'error')) findings.push({ topicId: film.topicId, severity: 'regression', detail: `质量闸门由 ${old.gate} 变为 ${film.gate}` });
    if (typeof film.integratedLufs === 'number' && Math.abs(film.integratedLufs + 14) > 1) findings.push({ topicId: film.topicId, severity: 'regression', detail: `响度 ${film.integratedLufs.toFixed(1)} LUFS，偏离 −14±1` });
    if (typeof film.truePeak === 'number' && film.truePeak > -1) findings.push({ topicId: film.topicId, severity: 'regression', detail: `真峰值 ${film.truePeak.toFixed(1)} dBTP，高于 −1` });
    if (old?.cost && film.cost && film.cost > old.cost * 1.5) findings.push({ topicId: film.topicId, severity: 'warning', detail: `费用 ${old.cost} → ${film.cost}（上涨超过 50%）` });
    if (old?.minutes && film.minutes && film.minutes > old.minutes * 1.5) findings.push({ topicId: film.topicId, severity: 'warning', detail: `耗时 ${old.minutes} → ${film.minutes} 分钟（上涨超过 50%）` });
    if (old?.durationSeconds && film.durationSeconds && Math.abs(film.durationSeconds - old.durationSeconds) > 1) findings.push({ topicId: film.topicId, severity: 'warning', detail: `时长 ${old.durationSeconds}s → ${film.durationSeconds}s` });
    if (film.images !== undefined && film.images > budget.maxImagesPerFilm) findings.push({ topicId: film.topicId, severity: 'warning', detail: `生图 ${film.images} 张，超过每片上限 ${budget.maxImagesPerFilm}` });
    if (film.minutes !== undefined && film.minutes > budget.maxMinutesPerFilm) findings.push({ topicId: film.topicId, severity: 'warning', detail: `耗时 ${film.minutes} 分钟，超过每片上限 ${budget.maxMinutesPerFilm}` });
  }
  const totalCost = current.films.reduce((sum, film) => sum + (film.cost ?? 0), 0);
  if (totalCost > budget.maxCost) findings.push({ topicId: '*', severity: 'warning', detail: `整轮费用 ${totalCost} ${budget.currency}，超过预算 ${budget.maxCost}` });
  return findings;
}

/** Checklist shown before a manual run. */
export function regressionChecklist(topics: readonly RegressionTopic[] = REGRESSION_TOPICS, budget: RegressionBudget = REGRESSION_BUDGET): string {
  return [
    `真实回归集：${topics.length} 个固定题目，整轮预算 ${budget.maxCost} ${budget.currency}，每片最多 ${budget.maxImagesPerFilm} 张图、${budget.maxMinutesPerFilm} 分钟。`,
    '运行前：在设置里确认模型与中转站（可先“探测中转站能力”），记下模型、应用版本和提示词版本。',
    ...topics.map((topic, index) => `${index + 1}. [${topic.route}] ${topic.title}（${topic.ratio}，约 ${topic.targetSeconds}s${topic.style ? `，风格 ${topic.style}` : ''}）：${topic.source}`),
    '运行后：把成片复制到归档目录，执行 `node node_modules/tsx/dist/cli.mjs scripts/regression-set.ts archive <目录>` 生成报告并与上次对比。',
  ].join('\n');
}
