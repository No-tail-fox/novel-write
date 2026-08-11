import {
  BENCHMARK_PLATFORMS,
  type BenchmarkAccount,
  type BenchmarkBurstScore,
  type BenchmarkGroup,
  type BenchmarkGroupInput,
  type BenchmarkLinkKind,
  type BenchmarkMetricKey,
  type BenchmarkMetrics,
  type BenchmarkMetricValue,
  type BenchmarkOpportunityInputs,
  type BenchmarkPlatform,
  type BenchmarkPost,
  type BenchmarkPostInput,
} from './types';

const METRIC_WEIGHTS: Partial<Record<BenchmarkMetricKey, number>> = {
  likes: 1,
  comments: 3,
  favorites: 4,
  shares: 5,
  coins: 4,
  danmaku: 2,
};

export const benchmarkPlatforms = BENCHMARK_PLATFORMS;

export function benchmarkPlatformLabel(platform: BenchmarkPlatform): string {
  return { douyin: '抖音', 'wechat-channels': '视频号', bilibili: 'B站' }[platform];
}

export function classifyBenchmarkUrl(value: string): { platform: BenchmarkPlatform | 'unknown'; kind: BenchmarkLinkKind } {
  const parsed = parseHttpUrl(value);
  if (!parsed) return { platform: 'unknown', kind: 'unknown' };
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$|(^|\.)amemv\.com$/u.test(host)) {
    if (/\/video\//u.test(path)) return { platform: 'douyin', kind: 'post' };
    if (/\/user\//u.test(path)) return { platform: 'douyin', kind: 'account' };
    return { platform: 'douyin', kind: 'unknown' };
  }
  if (host === 'channels.weixin.qq.com' || host === 'weixin.qq.com' || host === 'wxv.qq.com' || host === 'finder.video.qq.com') {
    if (/\/s\/|\/feed\/|\/video\//u.test(path)) return { platform: 'wechat-channels', kind: 'post' };
    if (/\/profile\/|\/finder\/|\/pages\/profile\//u.test(path)) return { platform: 'wechat-channels', kind: 'account' };
    return { platform: 'wechat-channels', kind: 'unknown' };
  }
  if (host === 'space.bilibili.com') return { platform: 'bilibili', kind: 'account' };
  if (/(^|\.)bilibili\.com$|(^|\.)b23\.tv$/u.test(host)) {
    if (/\/video\//u.test(path)) return { platform: 'bilibili', kind: 'post' };
    return { platform: 'bilibili', kind: 'unknown' };
  }
  return { platform: 'unknown', kind: 'unknown' };
}

export function normalizeBenchmarkSourceUrl(value: string): string {
  const parsed = parseHttpUrl(value);
  if (!parsed) throw new Error('BENCHMARK_INVALID_URL: 请输入有效的 http(s) 链接。');
  parsed.hash = '';
  parsed.search = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  return parsed.toString().replace(/\/$/u, '');
}

export function normalizeBenchmarkGroupInput(input: BenchmarkGroupInput, existing?: BenchmarkGroup | null, now = Date.now()): BenchmarkGroup {
  const id = input.id?.trim() || existing?.id || createBenchmarkId();
  const name = input.name.trim();
  if (!name) throw new Error('BENCHMARK_GROUP_NAME_REQUIRED: 请填写对标组名称。');
  const seenPlatforms = new Set<BenchmarkPlatform>();
  const accounts: BenchmarkAccount[] = input.accounts.map((account) => {
    if (seenPlatforms.has(account.platform)) throw new Error(`BENCHMARK_DUPLICATE_PLATFORM: ${benchmarkPlatformLabel(account.platform)}只能添加一个账号链接。`);
    seenPlatforms.add(account.platform);
    const url = normalizeBenchmarkSourceUrl(account.url);
    const classification = classifyBenchmarkUrl(url);
    if (classification.platform !== account.platform) throw new Error(`BENCHMARK_PLATFORM_MISMATCH: 链接不是${benchmarkPlatformLabel(account.platform)}链接。`);
    if (classification.kind === 'post') throw new Error(`BENCHMARK_ACCOUNT_LINK_REQUIRED: ${benchmarkPlatformLabel(account.platform)}输入的是作品链接，请改用账号主页链接。`);
    const previous = existing?.accounts.find((item) => item.platform === account.platform && item.url === url);
    return {
      id: `${id}:${account.platform}`,
      platform: account.platform,
      url,
      displayName: account.displayName?.trim() || previous?.displayName || '',
      syncState: previous?.syncState ?? 'manual-only',
      lastSyncedAt: previous?.lastSyncedAt ?? null,
      errorMessage: previous?.errorMessage ?? '',
    };
  });
  if (accounts.length === 0) throw new Error('BENCHMARK_ACCOUNT_REQUIRED: 请至少添加一个平台账号链接。');
  return {
    id,
    name,
    track: input.track?.trim() || existing?.track || '',
    tags: uniqueText(input.tags ?? existing?.tags ?? []),
    notes: input.notes?.trim() ?? existing?.notes ?? '',
    refreshPolicy: input.refreshPolicy ?? existing?.refreshPolicy ?? 'manual',
    accounts,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function normalizeBenchmarkPostInput(input: BenchmarkPostInput, existing?: BenchmarkPost | null, now = Date.now()): BenchmarkPost {
  const sourceUrl = normalizeBenchmarkSourceUrl(input.sourceUrl);
  const classification = classifyBenchmarkUrl(sourceUrl);
  if (classification.platform !== input.platform) throw new Error(`BENCHMARK_PLATFORM_MISMATCH: 作品链接不是${benchmarkPlatformLabel(input.platform)}链接。`);
  if (classification.kind === 'account') throw new Error('BENCHMARK_POST_LINK_REQUIRED: 请输入作品链接，不要输入账号主页。');
  const title = input.title.trim();
  if (!title) throw new Error('BENCHMARK_POST_TITLE_REQUIRED: 请填写作品标题。');
  const nextMetrics = input.metrics ? normalizeMetrics({ ...existing?.metrics, ...input.metrics }) : existing?.metrics ?? {};
  const snapshots = [...(existing?.snapshots ?? [])];
  if (input.metrics) {
    const capturedAt = normalizeTimestamp(input.metricCapturedAt, now);
    const snapshot = { capturedAt, metrics: normalizeMetrics(input.metrics) };
    const previousIndex = snapshots.findIndex((item) => item.capturedAt === capturedAt);
    if (previousIndex >= 0) snapshots[previousIndex] = snapshot;
    else snapshots.push(snapshot);
    snapshots.sort((a, b) => a.capturedAt - b.capturedAt);
  }
  return {
    id: input.id?.trim() || existing?.id || createBenchmarkId(),
    groupId: input.groupId.trim(),
    platform: input.platform,
    sourceUrl,
    title,
    author: input.author?.trim() ?? existing?.author ?? '',
    accountUrl: input.accountUrl ? normalizeBenchmarkSourceUrl(input.accountUrl) : existing?.accountUrl ?? '',
    coverUrl: input.coverUrl?.trim() ?? existing?.coverUrl ?? '',
    publishedAt: normalizeOptionalTimestamp(input.publishedAt, existing?.publishedAt ?? null),
    durationSeconds: normalizeOptionalNumber(input.durationSeconds, existing?.durationSeconds ?? null),
    transcript: input.transcript?.trim() ?? existing?.transcript ?? '',
    tags: uniqueText(input.tags ?? existing?.tags ?? []),
    metrics: nextMetrics,
    snapshots,
    isFavorite: input.isFavorite ?? existing?.isFavorite ?? false,
    workflowStatus: input.workflowStatus ?? existing?.workflowStatus ?? 'new',
    note: input.note?.trim() ?? existing?.note ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function benchmarkOpportunityTotal(input: BenchmarkOpportunityInputs): number {
  return Math.round(
    clampScore(input.demand) * 0.3
      + clampScore(input.gap) * 0.25
      + clampScore(input.fit) * 0.2
      + clampScore(input.conversion) * 0.15
      + clampScore(input.executionEase) * 0.1,
  );
}

export function scoreBenchmarkPost(post: BenchmarkPost, peers: readonly BenchmarkPost[]): BenchmarkBurstScore {
  const availableMetrics = Object.values(post.metrics).filter((metric) => metric?.value !== null && metric?.value !== undefined).length;
  const engagement = weightedEngagement(post.metrics);
  if (availableMetrics === 0 || engagement <= 0) {
    return emptyBurstScore('缺少可用互动指标，暂不计算爆发分。');
  }
  const platformPeers = peers.filter((item) => item.groupId === post.groupId && item.platform === post.platform && weightedEngagement(item.metrics) > 0);
  const accountPercentile = percentile(engagement, platformPeers.map((item) => weightedEngagement(item.metrics)));
  const velocityValue = snapshotVelocity(post);
  const peerVelocities = platformPeers.map(snapshotVelocity).filter((value): value is number => value !== null);
  const velocity = velocityValue === null ? 0 : percentile(velocityValue, peerVelocities);
  const deepEngagement = deepEngagementScore(post.metrics);
  const topicPeers = peers.filter((item) => item.id !== post.id && overlaps(item.tags, post.tags));
  const topicHeat = clampScore(35 + Math.min(65, topicPeers.length * 8));
  const crossPlatform = clampScore(new Set(topicPeers.map((item) => item.platform).filter((platform) => platform !== post.platform)).size * 50);
  const score = Math.round(accountPercentile * 0.35 + velocity * 0.25 + deepEngagement * 0.2 + topicHeat * 0.1 + crossPlatform * 0.1);
  const confidence = platformPeers.length >= 10 && post.snapshots.length >= 2 && availableMetrics >= 3
    ? 'high'
    : platformPeers.length >= 3 && availableMetrics >= 2
      ? 'medium'
      : 'low';
  const explanation = [
    `账号内表现位于前 ${Math.max(1, 100 - Math.round(accountPercentile))}%`,
    velocityValue === null ? '仅有一次快照，暂不能判断增长速度' : `互动增长速度处于第 ${Math.round(velocity)} 百分位`,
    `深互动质量 ${Math.round(deepEngagement)} 分`,
  ].join('；');
  return {
    score,
    confidence,
    components: { accountPercentile, velocity, deepEngagement, topicHeat, crossPlatform },
    explanation: `${explanation}。`,
  };
}

export function benchmarkMetricNumber(metrics: BenchmarkMetrics, key: BenchmarkMetricKey): number | null {
  const value = metrics[key]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeMetrics(metrics: BenchmarkMetrics): BenchmarkMetrics {
  const next: BenchmarkMetrics = {};
  for (const [key, metric] of Object.entries(metrics) as Array<[BenchmarkMetricKey, BenchmarkMetricValue | undefined]>) {
    if (!metric) continue;
    const value = metric.value === null ? null : Number(metric.value);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`BENCHMARK_METRIC_INVALID: ${key} 必须是非负有限数字或空值。`);
    next[key] = { value, ...(value === null && metric.reason?.trim() ? { reason: metric.reason.trim() } : {}) };
  }
  return next;
}

function weightedEngagement(metrics: BenchmarkMetrics): number {
  return Object.entries(METRIC_WEIGHTS).reduce((total, [key, weight]) => total + (benchmarkMetricNumber(metrics, key as BenchmarkMetricKey) ?? 0) * (weight ?? 0), 0);
}

function snapshotVelocity(post: BenchmarkPost): number | null {
  if (post.snapshots.length < 2) return null;
  const first = post.snapshots[0];
  const last = post.snapshots[post.snapshots.length - 1];
  const hours = (last.capturedAt - first.capturedAt) / 3_600_000;
  if (hours <= 0) return null;
  return Math.max(0, weightedEngagement(last.metrics) - weightedEngagement(first.metrics)) / hours;
}

function deepEngagementScore(metrics: BenchmarkMetrics): number {
  const likes = benchmarkMetricNumber(metrics, 'likes') ?? 0;
  const deep = (benchmarkMetricNumber(metrics, 'comments') ?? 0) * 3
    + (benchmarkMetricNumber(metrics, 'favorites') ?? 0) * 4
    + (benchmarkMetricNumber(metrics, 'shares') ?? 0) * 5
    + (benchmarkMetricNumber(metrics, 'coins') ?? 0) * 4
    + (benchmarkMetricNumber(metrics, 'danmaku') ?? 0) * 2;
  return clampScore((deep / Math.max(1, likes + deep)) * 180);
}

function percentile(value: number, values: readonly number[]): number {
  if (values.length === 0) return 50;
  const lower = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return clampScore(((lower + equal * 0.5) / values.length) * 100);
}

function emptyBurstScore(explanation: string): BenchmarkBurstScore {
  return {
    score: null,
    confidence: 'low',
    components: { accountPercentile: 0, velocity: 0, deepEngagement: 0, topicHeat: 0, crossPlatform: 0 },
    explanation,
  };
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTimestamp(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeOptionalTimestamp(value: number | null | undefined, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeOptionalNumber(value: number | null | undefined, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.some((item) => rightSet.has(item.toLowerCase()));
}

function createBenchmarkId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `benchmark-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
