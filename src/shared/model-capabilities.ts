/**
 * G-1: model capability profiles.
 *
 * Inferred from the model id because relay stations rename freely and rarely expose metadata.
 * The profile drives three decisions: which route tier a model can carry (U-6), which fallback
 * candidates are sensible (G-1 chain) and safe output budgets. Unknown models get a conservative
 * T2 profile; nothing here ever blocks a user-chosen model.
 */

export type ModelTier = 'T1' | 'T2' | 'T3';

export interface ModelCapabilities {
  model: string;
  family: string;
  /** T1: long-form code/film authoring (Lemo, VOX code). T2: planning/JSON. T3: short text only. */
  tier: ModelTier;
  vision: boolean;
  tools: boolean;
  /** Reasoning model: needs larger output budgets for the same visible answer. */
  thinking: boolean;
  maxOutputTokens: number;
  contextTokens: number;
  known: boolean;
}

interface Rule { pattern: RegExp; family: string; tier: ModelTier; vision?: boolean; tools?: boolean; thinking?: boolean; maxOutputTokens: number; contextTokens: number }

const RULES: Rule[] = [
  { pattern: /claude-(?:opus|sonnet)|claude-3[.-]7|claude-(?:4|5)/iu, family: 'claude', tier: 'T1', vision: true, tools: true, thinking: true, maxOutputTokens: 64_000, contextTokens: 200_000 },
  { pattern: /claude-.*haiku/iu, family: 'claude-haiku', tier: 'T2', vision: true, tools: true, maxOutputTokens: 8_192, contextTokens: 200_000 },
  { pattern: /gemini-[\d.]+-pro|gemini-pro|gemini-exp/iu, family: 'gemini-pro', tier: 'T1', vision: true, tools: true, thinking: true, maxOutputTokens: 65_536, contextTokens: 1_000_000 },
  { pattern: /gemini-[\d.]+-flash-lite/iu, family: 'gemini-flash-lite', tier: 'T3', vision: true, tools: true, maxOutputTokens: 8_192, contextTokens: 1_000_000 },
  { pattern: /gemini-[\d.]+-flash|gemini-flash/iu, family: 'gemini-flash', tier: 'T2', vision: true, tools: true, thinking: true, maxOutputTokens: 65_536, contextTokens: 1_000_000 },
  { pattern: /gpt-5(?![\d.]*-(?:mini|nano))|gpt-4\.1(?!-(?:mini|nano))|\bo3\b|\bo1\b(?!-mini)/iu, family: 'gpt-frontier', tier: 'T1', vision: true, tools: true, thinking: true, maxOutputTokens: 32_768, contextTokens: 400_000 },
  { pattern: /gpt-5[\d.]*-mini|gpt-4\.1-mini|gpt-4o(?!-mini)|o[134]-mini/iu, family: 'gpt-mid', tier: 'T2', vision: true, tools: true, maxOutputTokens: 16_384, contextTokens: 128_000 },
  { pattern: /gpt-5[\d.]*-nano|gpt-4\.1-nano|gpt-4o-mini|gpt-3\.5/iu, family: 'gpt-small', tier: 'T3', vision: true, tools: true, maxOutputTokens: 16_384, contextTokens: 128_000 },
  { pattern: /deepseek-(?:r1|reasoner)/iu, family: 'deepseek-reasoner', tier: 'T2', thinking: true, maxOutputTokens: 32_768, contextTokens: 128_000 },
  // Measured against the relay's chat endpoint: this exact model accepts image input. Other deepseek ids stay text-only.
  { pattern: /deepseek-v4\.1-flash/iu, family: 'deepseek', tier: 'T2', vision: true, tools: true, maxOutputTokens: 8_192, contextTokens: 128_000 },
  { pattern: /deepseek/iu, family: 'deepseek', tier: 'T2', tools: true, maxOutputTokens: 8_192, contextTokens: 128_000 },
  { pattern: /qwen[\d.]*-(?:max|plus)|qwen3-(?:coder|235b)|kimi-k2|glm-4\.[5-9]|glm-[5-9]/iu, family: 'open-frontier', tier: 'T2', tools: true, maxOutputTokens: 16_384, contextTokens: 128_000 },
  { pattern: /qwen|llama|mistral|glm|yi-|phi-|gemma/iu, family: 'open-small', tier: 'T3', maxOutputTokens: 8_192, contextTokens: 32_000 },
];

export function inferModelCapabilities(model: string): ModelCapabilities {
  const id = model.trim();
  const rule = RULES.find(candidate => candidate.pattern.test(id));
  if (!rule) return { model: id, family: 'unknown', tier: 'T2', vision: false, tools: false, thinking: false, maxOutputTokens: 8_192, contextTokens: 32_000, known: false };
  return { model: id, family: rule.family, tier: rule.tier, vision: Boolean(rule.vision), tools: Boolean(rule.tools), thinking: Boolean(rule.thinking), maxOutputTokens: rule.maxOutputTokens, contextTokens: rule.contextTokens, known: true };
}

const TIER_RANK: Record<ModelTier, number> = { T1: 1, T2: 2, T3: 3 };

/** True when `model` can carry work that needs `required` (T1 can do everything). */
export function modelMeetsTier(model: string, required: ModelTier): boolean {
  return TIER_RANK[inferModelCapabilities(model).tier] <= TIER_RANK[required];
}

/** Short Chinese summary for the settings page. */
export function describeModelCapabilities(model: string, fallbackModels?: string[]): string {
  if (!model.trim()) return '未选择模型';
  const caps = inferModelCapabilities(model);
  const tierLabel: Record<ModelTier, string> = { T1: 'T1 可承担长代码/整片创作', T2: 'T2 适合规划与结构化输出', T3: 'T3 只适合短文本' };
  const traits = [caps.vision ? '识图' : '', caps.tools ? '工具调用' : '', caps.thinking ? '推理' : ''].filter(Boolean).join('、');
  const base = caps.known ? `${tierLabel[caps.tier]}${traits ? `；${traits}` : ''}` : '未识别的模型，按 T2 保守处理';
  const fallbacks = normalizeFallbackModels(model, fallbackModels);
  return fallbacks.length ? `${base}。模型不存在、通道不可用或过载时依次改用：${fallbacks.join(' → ')}（结果未知的请求不会换模型重发）` : base;
}

/** Normalise a user-entered fallback list: trimmed, de-duplicated, without the primary, at most 4. */
export function normalizeFallbackModels(primary: string, value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n，]/u) : [];
  const seen = new Set([primary.trim()]);
  const result: string[] = [];
  for (const item of raw) {
    const model = String(item ?? '').trim();
    if (!model || model.length > 200 || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
    if (result.length === 4) break;
  }
  return result;
}

const NON_CHAT_MODEL = /image|dall-e|embedding|embed|tts|whisper|audio|speech|moderation|rerank|vision-preview|realtime|transcribe|search|seedream|jimeng|flux|sdxl|midjourney|video|veo|sora|kling/iu;

/**
 * G-6/U-6: suggest fallback models from the endpoint's own model list (same key, same billing), so a
 * 404/no-channel on the primary does not stop the task. Only recognised chat models of the same family
 * tier or better are proposed, closest family first. The user still decides; nothing is saved here.
 */
export function recommendFallbackModels(primary: string, available: readonly string[], max = 2): string[] {
  const primaryCaps = inferModelCapabilities(primary);
  const candidates = [...new Set(available.map(id => id.trim()).filter(Boolean))]
    .filter(id => id !== primary.trim() && !NON_CHAT_MODEL.test(id))
    .map(id => ({ id, caps: inferModelCapabilities(id) }))
    .filter(({ caps }) => caps.known && TIER_RANK[caps.tier] <= TIER_RANK[primaryCaps.tier]);
  candidates.sort((a, b) =>
    Number(b.caps.family === primaryCaps.family) - Number(a.caps.family === primaryCaps.family)
    || TIER_RANK[a.caps.tier] - TIER_RANK[b.caps.tier]
    || Number(/preview|exp|beta/iu.test(a.id)) - Number(/preview|exp|beta/iu.test(b.id))
    || a.id.localeCompare(b.id));
  return candidates.slice(0, Math.max(0, Math.min(4, max))).map(({ id }) => id);
}

/** Production routes a project can take. `lemo` = 创意动画 (agent whole film), `html` = 场景代码, `template` = 模板动画. */
export type ProductionRouteKind = 'lemo' | 'html' | 'template';

/** Model tier each route needs (model tiers: T1 strongest). Templates run on any model. */
const ROUTE_REQUIRED_TIER: Record<ProductionRouteKind, ModelTier> = { lemo: 'T1', html: 'T2', template: 'T3' };
const ROUTE_LABEL: Record<ProductionRouteKind, string> = { lemo: '创意动画', html: 'HTML 场景代码', template: '模板动画' };

export interface RouteRecommendation {
  /** Most ambitious route the model can carry. */
  recommended: ProductionRouteKind;
  /** Set when the chosen route needs a stronger model; the user may still proceed. */
  warning?: string;
  /** Route to fall back to when the chosen route does not fit (never applied automatically). */
  downgradeTo?: ProductionRouteKind;
}

/**
 * U-6: recommend a route from the project LLM, and warn (never block) when the chosen route needs a
 * stronger model. Unknown models are treated as T2, so they are warned about only for 创意动画.
 */
export function recommendProductionRoute(model: string, chosen?: ProductionRouteKind): RouteRecommendation {
  const caps = inferModelCapabilities(model);
  const recommended: ProductionRouteKind = caps.tier === 'T1' ? 'lemo' : caps.tier === 'T2' ? 'html' : 'template';
  if (!chosen || modelMeetsTier(model, ROUTE_REQUIRED_TIER[chosen])) return { recommended };
  const name = model.trim() || '当前模型';
  const identity = caps.known ? `${name}（${caps.tier}）` : `${name}（未识别，按 T2 处理）`;
  return {
    recommended,
    downgradeTo: recommended,
    warning: `${ROUTE_LABEL[chosen]}需要 ${ROUTE_REQUIRED_TIER[chosen]} 级语言模型，${identity}可能写不完整或反复失败。建议换更强的模型，或改用${ROUTE_LABEL[recommended]}。`,
  };
}
