/**
 * H-5 follow-up: controllable image budget ("生图张数"). Pure and renderer-safe.
 *
 * Modes:
 *  - `standard` (default when the policy is absent): today's behaviour, every slot is generated.
 *  - `economy`: one image per scene. The separate foreground (subject cut-out) layer is not generated
 *    (scenes keep their planned elements, which simply have no image), and the cover reuses the
 *    first scene image.
 *  - `minimal`: one image shared by every `shareEvery` scenes (default 3). The first scene of each
 *    group gets a new image and the rest of the group reuses it. No foreground layer, and the cover
 *    reuses a scene image.
 *
 * `maxImages` (1–100) is a hard cap applied after the mode. The order is fixed so the result is
 * deterministic:
 *  1. Scene images come first. If there are more groups than the cap, the planner picks evenly spaced
 *     groups (first and last included). Every other group reuses the nearest chosen one; on a tie it
 *     takes the earlier one.
 *  2. Foreground (`element`) slots are generated only if all of them fit in the remaining budget.
 *     Otherwise the whole foreground layer is omitted, never a part of it.
 *  3. The cover gets a new image only if budget is left. Otherwise it reuses the first scene image.
 *
 * A reused slot never calls the image provider. The route copies the source into a private file
 * whose name contains `.reuse-` (see HTML_REUSED_IMAGE_MARKER), so the slot can still be
 * regenerated alone and the cost panel does not count the copy as a paid call.
 */

export const IMAGE_BUDGET_MODES = ['standard', 'economy', 'minimal'] as const;
export type ImageBudgetMode = typeof IMAGE_BUDGET_MODES[number];
export const IMAGE_BUDGET_MODE_LABELS: Record<ImageBudgetMode, string> = { standard: '标准', economy: '省图', minimal: '极省' };
export const IMAGE_BUDGET_MAX_IMAGES_MIN = 1;
export const IMAGE_BUDGET_MAX_IMAGES_MAX = 100;
export const IMAGE_BUDGET_SHARE_EVERY_MIN = 2;
export const IMAGE_BUDGET_SHARE_EVERY_MAX = 10;
export const IMAGE_BUDGET_SHARE_EVERY_DEFAULT = 3;

export interface ImageBudgetPolicy {
  mode: ImageBudgetMode;
  /** Hard cap on new provider images for one video (1–100). Absent = no cap. */
  maxImages?: number;
  /** `minimal` only: scenes per shared image (2–10, default 3). */
  shareEvery?: number;
}

export type ImageBudgetSlotKind = 'scene' | 'element' | 'cover';
export interface ImageBudgetSlot {
  id: string;
  /** Scene order key (index or id); scene slots are planned in ascending order. */
  scene: number;
  kind: ImageBudgetSlotKind;
}
export interface ImageBudgetReuse<S extends ImageBudgetSlot = ImageBudgetSlot> { slot: S; from: S }
export interface ImageBudgetPlan<S extends ImageBudgetSlot = ImageBudgetSlot> {
  /** Slots that call the image provider, in input order. */
  generate: S[];
  /** Slots filled from a generated slot without a provider call, in input order. */
  reuse: ImageBudgetReuse<S>[];
  /** Foreground slots dropped by the policy (economy / minimal / cap); nothing is produced for them. */
  omit: S[];
  expectedCalls: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Strict parse for persisted / IPC data. Throws on an invalid value. */
export function parseImageBudgetPolicy(value: unknown): ImageBudgetPolicy {
  if (!isRecord(value)) throw new Error('imageBudget must be an object');
  const unknownField = Object.keys(value).find((key) => !['mode', 'maxImages', 'shareEvery'].includes(key));
  if (unknownField) throw new Error(`imageBudget contains unknown field ${unknownField}`);
  if (!IMAGE_BUDGET_MODES.includes(value.mode as ImageBudgetMode)) throw new Error('imageBudget.mode is invalid');
  const policy: ImageBudgetPolicy = { mode: value.mode as ImageBudgetMode };
  if (value.maxImages !== undefined) {
    const maxImages = integerInRange(value.maxImages, IMAGE_BUDGET_MAX_IMAGES_MIN, IMAGE_BUDGET_MAX_IMAGES_MAX);
    if (maxImages === undefined) throw new Error(`imageBudget.maxImages must be an integer from ${IMAGE_BUDGET_MAX_IMAGES_MIN} to ${IMAGE_BUDGET_MAX_IMAGES_MAX}`);
    policy.maxImages = maxImages;
  }
  if (value.shareEvery !== undefined) {
    const shareEvery = integerInRange(value.shareEvery, IMAGE_BUDGET_SHARE_EVERY_MIN, IMAGE_BUDGET_SHARE_EVERY_MAX);
    if (shareEvery === undefined) throw new Error(`imageBudget.shareEvery must be an integer from ${IMAGE_BUDGET_SHARE_EVERY_MIN} to ${IMAGE_BUDGET_SHARE_EVERY_MAX}`);
    policy.shareEvery = shareEvery;
  }
  return policy;
}

/** Lenient read for data of unknown age: absent or invalid → undefined (= standard). */
export function normalizeImageBudgetPolicy(value: unknown): ImageBudgetPolicy | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return parseImageBudgetPolicy(value);
  } catch {
    return undefined;
  }
}

/** True when the policy changes nothing (absent, or standard without a cap). */
export function isDefaultImageBudget(policy: ImageBudgetPolicy | null | undefined): boolean {
  return !policy || (policy.mode === 'standard' && policy.maxImages === undefined);
}

/** Policy to persist: undefined for the default, so old and default projects stay byte-identical. */
export function compactImageBudgetPolicy(policy: ImageBudgetPolicy | null | undefined): ImageBudgetPolicy | undefined {
  const normalized = normalizeImageBudgetPolicy(policy);
  return normalized && !isDefaultImageBudget(normalized) ? normalized : undefined;
}

/** UI helper: policy from the "生图张数" control (empty / invalid number = no cap). */
export function imageBudgetFromControl(mode: ImageBudgetMode, maxImagesText: string): ImageBudgetPolicy | undefined {
  const trimmed = maxImagesText.trim();
  const maxImages = trimmed ? integerInRange(Number(trimmed), IMAGE_BUDGET_MAX_IMAGES_MIN, IMAGE_BUDGET_MAX_IMAGES_MAX) : undefined;
  return compactImageBudgetPolicy({ mode, ...(maxImages === undefined ? {} : { maxImages }) });
}

export function sameImageBudget(left: ImageBudgetPolicy | null | undefined, right: ImageBudgetPolicy | null | undefined): boolean {
  const a = compactImageBudgetPolicy(left);
  const b = compactImageBudgetPolicy(right);
  return a?.mode === b?.mode && a?.maxImages === b?.maxImages && a?.shareEvery === b?.shareEvery;
}

function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  if (count <= 1) return items.length ? [items[0]] : [];
  const picked: T[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(items[Math.round(index * (items.length - 1) / (count - 1))]);
  }
  return picked;
}

function nearest(candidates: readonly number[], target: number): number {
  let best = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(candidate - target) < Math.abs(best - target)) best = candidate;
  }
  return best;
}

export function planImageBudget<S extends ImageBudgetSlot>(
  slots: readonly S[],
  policy?: ImageBudgetPolicy | null,
): ImageBudgetPlan<S> {
  const resolved = normalizeImageBudgetPolicy(policy) ?? { mode: 'standard' as const };
  const scenes = slots
    .map((slot, order) => ({ slot, order }))
    .filter(({ slot }) => slot.kind === 'scene')
    .sort((left, right) => left.slot.scene - right.slot.scene || left.order - right.order)
    .map(({ slot }) => slot);
  const elements = slots.filter((slot) => slot.kind === 'element');
  const covers = slots.filter((slot) => slot.kind === 'cover');
  const cap = resolved.maxImages;

  const groupSize = resolved.mode === 'minimal' ? resolved.shareEvery ?? IMAGE_BUDGET_SHARE_EVERY_DEFAULT : 1;
  const leaders: number[] = [];
  for (let position = 0; position < scenes.length; position += groupSize) leaders.push(position);
  const chosen = cap !== undefined && leaders.length > cap ? evenlySpaced(leaders, cap) : leaders;
  const chosenSet = new Set(chosen);

  const sourceOf = new Map<S, S>();
  for (let position = 0; position < scenes.length; position += 1) {
    const leader = position - (position % groupSize);
    const source = chosenSet.has(leader) ? leader : nearest(chosen, leader);
    if (source !== position) sourceOf.set(scenes[position], scenes[source]);
  }
  let used = chosen.length;

  const keepElements = resolved.mode === 'standard' && (cap === undefined || used + elements.length <= cap);
  const omitted = new Set<S>(keepElements ? [] : elements);
  if (keepElements) used += elements.length;

  const firstSceneSource = scenes.length ? sourceOf.get(scenes[0]) ?? scenes[0] : undefined;
  let firstCover: S | undefined;
  for (const cover of covers) {
    const overCap = cap !== undefined && used >= cap;
    if (firstSceneSource && (resolved.mode !== 'standard' || overCap)) {
      sourceOf.set(cover, firstSceneSource);
    } else if (firstCover && overCap) {
      sourceOf.set(cover, firstCover);
    } else {
      firstCover ??= cover;
      used += 1;
    }
  }

  const generate: S[] = [];
  const reuse: ImageBudgetReuse<S>[] = [];
  const omit: S[] = [];
  for (const slot of slots) {
    const from = sourceOf.get(slot);
    if (omitted.has(slot)) omit.push(slot);
    else if (from) reuse.push({ slot, from });
    else generate.push(slot);
  }
  return { generate, reuse, omit, expectedCalls: generate.length };
}

// ---------------------------------------------------------------------------------------------
// HTML route helpers (scene plans from pipelineData; read defensively, may be of any age).

export interface ImageBudgetHtmlScene {
  index: number;
  elements: readonly { slot: number }[];
}
export interface ImageBudgetHtmlConfig {
  foreground?: boolean;
  coverImageMode?: string;
  imageBudget?: ImageBudgetPolicy;
}
export type HtmlImageBudgetSlot = ImageBudgetSlot & { sceneIndex: number; assetKind: 'bg' | 'fg' | 'cover'; slotIndex: number };

export function htmlVideoImageBudgetSlots(
  scenes: readonly ImageBudgetHtmlScene[],
  config: ImageBudgetHtmlConfig,
  options: { includeCover?: boolean } = {},
): HtmlImageBudgetSlot[] {
  const slots: HtmlImageBudgetSlot[] = [];
  for (const scene of scenes) {
    slots.push({ id: `bg:${scene.index}`, scene: scene.index, kind: 'scene', sceneIndex: scene.index, assetKind: 'bg', slotIndex: 0 });
    if (config.foreground !== false) {
      for (const element of scene.elements) {
        slots.push({ id: `fg:${scene.index}:${element.slot}`, scene: scene.index, kind: 'element', sceneIndex: scene.index, assetKind: 'fg', slotIndex: element.slot });
      }
    }
  }
  if (options.includeCover !== false && config.coverImageMode === 'auto') {
    slots.push({ id: 'cover', scene: Number.MAX_SAFE_INTEGER, kind: 'cover', sceneIndex: 0, assetKind: 'cover', slotIndex: 0 });
  }
  return slots;
}

/** HTML plan. Scene/foreground decisions never depend on the cover (it only gets leftover budget). */
export function planHtmlVideoImageBudget(
  scenes: readonly ImageBudgetHtmlScene[],
  config: ImageBudgetHtmlConfig,
  options: { includeCover?: boolean } = {},
): ImageBudgetPlan<HtmlImageBudgetSlot> {
  return planImageBudget(htmlVideoImageBudgetSlots(scenes, config, options), config.imageBudget);
}

/**
 * Provider calls before the scenes are planned (create form): `sceneCount` scenes with the default
 * planner's one foreground element per scene when the foreground layer is on.
 */
export function estimateHtmlVideoImageCalls(sceneCount: number, config: ImageBudgetHtmlConfig): number {
  const count = Math.max(0, Math.floor(Number.isFinite(sceneCount) ? sceneCount : 0));
  const scenes = Array.from({ length: count }, (_, index): ImageBudgetHtmlScene => ({
    index: index + 1,
    elements: config.foreground === false ? [] : [{ slot: 0 }],
  }));
  return planHtmlVideoImageBudget(scenes, config).expectedCalls;
}

/** Whether the foreground layer is generated (and therefore required) for these scenes. */
export function htmlVideoForegroundEnabled(scenes: readonly ImageBudgetHtmlScene[], config: ImageBudgetHtmlConfig): boolean {
  if (config.foreground === false) return false;
  if (isDefaultImageBudget(config.imageBudget)) return true;
  return planHtmlVideoImageBudget(scenes, config, { includeCover: false }).omit.length === 0;
}

/** Whether an automatic HTML cover reuses a scene image instead of calling the provider. */
export function htmlVideoCoverReusesScene(scenes: readonly ImageBudgetHtmlScene[], config: ImageBudgetHtmlConfig): boolean {
  if (config.coverImageMode !== 'auto' || isDefaultImageBudget(config.imageBudget)) return false;
  return planHtmlVideoImageBudget(scenes, config).reuse.some((entry) => entry.slot.kind === 'cover');
}

// ---------------------------------------------------------------------------------------------
// Template (storyboard) route helpers.

export type TemplateImageBudgetSlot = ImageBudgetSlot & { sceneId: number };

export function templateImageBudgetSlots(sceneIds: readonly number[], options: { cover: boolean }): TemplateImageBudgetSlot[] {
  return [
    ...sceneIds.map((sceneId): TemplateImageBudgetSlot => ({ id: `scene:${sceneId}`, scene: sceneId, kind: 'scene', sceneId })),
    ...(options.cover ? [{ id: 'cover', scene: Number.MAX_SAFE_INTEGER, kind: 'cover' as const, sceneId: 0 }] : []),
  ];
}

export function planTemplateImageBudget(
  sceneIds: readonly number[],
  options: { cover: boolean; policy?: ImageBudgetPolicy | null },
): ImageBudgetPlan<TemplateImageBudgetSlot> {
  return planImageBudget(templateImageBudgetSlots(sceneIds, { cover: options.cover }), options.policy);
}

/** Short Chinese description of a policy (summary rows, events). */
export function describeImageBudget(policy: ImageBudgetPolicy | null | undefined): string {
  const resolved = normalizeImageBudgetPolicy(policy) ?? { mode: 'standard' as const };
  const base = resolved.mode === 'minimal'
    ? `极省（每 ${resolved.shareEvery ?? IMAGE_BUDGET_SHARE_EVERY_DEFAULT} 个分镜共用 1 张）`
    : resolved.mode === 'economy' ? '省图（每个分镜 1 张，封面复用）' : '标准';
  return resolved.maxImages === undefined ? base : `${base} · 最多 ${resolved.maxImages} 张`;
}
