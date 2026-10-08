/**
 * StoryDream adaptation of Jellyfish (a9678194) shot-video readiness and
 * previous-shot continuity prompt packing. Modified for remote-only providers.
 */
import { invalidateMotionComicShotVideo, type MotionComicPipelineData, type MotionComicShot } from './motion-comic';
import type { ProductionAssetVersion } from './production-workflow';
import type { VideoGenerationRequest } from './video-provider';

export interface MotionComicVideoFrameSet {
  first: ProductionAssetVersion;
  last?: ProductionAssetVersion;
}

export interface MotionComicVideoInputFingerprintSource {
  shotId: string;
  episodeId: string;
  renderStrategy: 'remote-video';
  firstFrameAssetVersionId: string;
  firstFrameSha256?: string;
  lastFrameAssetVersionId?: string;
  lastFrameSha256?: string;
  prompt: string;
  durationSec: number;
  ratio: string;
  providerId: string;
  model: string;
  continuity: {
    series: {
      worldRules: string[];
      visualRules: string[];
      negativePrompt: string;
    };
    characters: Array<{
      id: string;
      name: string;
      identityPrompt: string;
      look: {
        id: string;
        label: string;
        appearancePrompt: string;
        wardrobe: string;
        continuityNotes: string;
        fixedReference: MotionComicVideoReferenceFingerprint | null;
      };
    }>;
    scene: {
      id: string;
      label: string;
      description: string;
      prompt: string;
      continuityNotes: string;
      fixedReference: MotionComicVideoReferenceFingerprint | null;
    } | null;
    props: Array<{
      id: string;
      label: string;
      description: string;
      prompt: string;
      fixedReference: MotionComicVideoReferenceFingerprint | null;
    }>;
  };
}

interface MotionComicVideoReferenceFingerprint {
  id: string;
  localPath?: string;
  sha256?: string;
}

export function motionComicVideoFrames(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): MotionComicVideoFrameSet {
  if (shot.renderStrategy !== 'remote-video') {
    throw new Error('DIRECTOR_VIDEO_STRATEGY_INVALID: 请先将镜头制作方式切换为远程视频。');
  }
  const first = frameAsset(document, shot.firstFrameAssetVersionId, '首帧');
  const last = shot.lastFrameAssetVersionId ? frameAsset(document, shot.lastFrameAssetVersionId, '尾帧') : undefined;
  return { first, last };
}

export function buildMotionComicShotVideoRequest(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): VideoGenerationRequest {
  const frames = motionComicVideoFrames(document, shot);
  return {
    prompt: motionComicVideoPrompt(document, shot),
    durationSec: Math.max(1, Math.ceil(shot.durationMs / 1_000)),
    ratio: document.ratio,
    generateAudio: false,
    firstFramePath: frames.first.localPath,
    ...(frames.last?.localPath ? { lastFramePath: frames.last.localPath } : {}),
  };
}

export function motionComicVideoInputFingerprintSource(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
  providerId: string,
  model: string,
): MotionComicVideoInputFingerprintSource {
  const frames = motionComicVideoFrames(document, shot);
  const request = buildMotionComicShotVideoRequest(document, shot);
  const characters = shot.characterLookIds.flatMap((lookId) => {
    for (const character of document.characters) {
      const look = character.looks.find((candidate) => candidate.id === lookId);
      if (!look) continue;
      return [{
        id: character.id,
        name: character.name,
        identityPrompt: character.identityPrompt,
        look: {
          id: look.id,
          label: look.label,
          appearancePrompt: look.appearancePrompt,
          wardrobe: look.wardrobe,
          continuityNotes: look.continuityNotes,
          fixedReference: fixedReferenceFingerprint(document, look.referenceAssetVersionIds),
        },
      }];
    }
    return [];
  });
  const scene = document.sceneAssets.find((candidate) => candidate.id === shot.sceneAssetId);
  const props = shot.propAssetIds.flatMap((id) => document.props.find((candidate) => candidate.id === id) ?? []);
  return {
    shotId: shot.id,
    episodeId: shot.episodeId,
    renderStrategy: 'remote-video',
    firstFrameAssetVersionId: frames.first.id,
    firstFrameSha256: frames.first.sha256,
    ...(frames.last ? { lastFrameAssetVersionId: frames.last.id, lastFrameSha256: frames.last.sha256 } : {}),
    prompt: request.prompt,
    durationSec: request.durationSec,
    ratio: request.ratio,
    providerId,
    model,
    continuity: {
      series: {
        worldRules: document.series.worldRules,
        visualRules: document.series.visualRules,
        negativePrompt: document.series.negativePrompt,
      },
      characters,
      scene: scene ? {
        id: scene.id,
        label: scene.label,
        description: scene.description,
        prompt: scene.prompt,
        continuityNotes: scene.continuityNotes,
        fixedReference: fixedReferenceFingerprint(document, scene.referenceAssetVersionIds),
      } : null,
      props: props.map((prop) => ({
        id: prop.id,
        label: prop.label,
        description: prop.description,
        prompt: prop.prompt,
        fixedReference: fixedReferenceFingerprint(document, prop.referenceAssetVersionIds),
      })),
    },
  };
}

export function motionComicVideoInputHash(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
  providerId: string,
  model: string,
): string {
  return sha256Utf8(JSON.stringify(motionComicVideoInputFingerprintSource(document, shot, providerId, model)));
}

export function motionComicVideoPrompt(document: MotionComicPipelineData, shot: MotionComicShot): string {
  const episode = document.episodes.find((candidate) => candidate.id === shot.episodeId);
  if (!episode) throw new Error(`DIRECTOR_VIDEO_EPISODE_NOT_FOUND: ${shot.episodeId}`);
  const ordered = episode.scenes.flatMap((scene) => scene.shots);
  const index = ordered.findIndex((candidate) => candidate.id === shot.id);
  if (index < 0) throw new Error(`DIRECTOR_VIDEO_SHOT_NOT_FOUND: ${shot.id}`);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const scene = document.sceneAssets.find((candidate) => candidate.id === shot.sceneAssetId);
  const looks = shot.characterLookIds.flatMap((lookId) => {
    for (const character of document.characters) {
      const look = character.looks.find((candidate) => candidate.id === lookId);
      if (look) return [{ character, look }];
    }
    return [];
  });
  const props = shot.propAssetIds.flatMap((id) => document.props.find((candidate) => candidate.id === id) ?? []);
  const continuity = shot.continuity;
  const sections = [
    `镜头目标：${shot.prompt.trim()}`,
    `动作与运镜：${shot.motionPrompt.trim()}`,
    `构图：${shot.framing.trim()}`,
    scene ? `场景连续性：${scene.label}；${compact(scene.description, 420)}；生成约束 ${compact(scene.prompt, 420)}；${compact(scene.continuityNotes, 420)}` : '',
    ...looks.map(({ character, look }) => `角色连续性：${character.name}（${look.label}）；身份 ${compact(character.identityPrompt, 360)}；外观 ${compact(look.appearancePrompt, 320)}；服装 ${compact(look.wardrobe, 280)}；${compact(look.continuityNotes, 360)}`),
    ...props.map((prop) => `道具连续性：${prop.label}；${compact(prop.description, 280)}；生成约束 ${compact(prop.prompt, 320)}`),
    previous?.continuity?.endState ? `承接上一镜出镜状态：${compact(previous.continuity.endState, 600)}` : '',
    continuity ? `本镜入镜状态：${compact(continuity.startState, 600)}\n动作顺序：${continuity.actionBeats.map((beat, beatIndex) => `${beatIndex + 1}. ${compact(beat, 420)}`).join('；')}\n本镜出镜状态：${compact(continuity.endState, 600)}\n银幕方向：${compact(continuity.screenDirection, 360)}` : '',
    document.series.worldRules.length ? `世界规则：${document.series.worldRules.map((rule) => compact(rule, 280)).join('；')}` : '',
    document.series.visualRules.length ? `系列视觉规则：${document.series.visualRules.map((rule) => compact(rule, 320)).join('；')}` : '',
    document.series.negativePrompt.trim() ? `必须避免：${compact(document.series.negativePrompt, 700)}` : '',
    '保持首帧中的人物身份、脸型、发型、服装、场景结构和光线方向。动作连续自然，不切镜，不换人，不新增文字或水印。',
  ].filter(Boolean);
  return compact(sections.join('\n'), 6_800);
}

/** Preserve history while detaching videos whose exact remote inputs changed. */
export function invalidateMotionComicVideosForChangedInputs(
  previous: MotionComicPipelineData,
  next: MotionComicPipelineData,
): MotionComicPipelineData {
  const previousShots = new Map(previous.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).map((shot) => [shot.id, shot]));
  const previousJobs = new Map(previous.providerJobs.map((job) => [job.id, job]));
  let result = next;
  for (const shot of next.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots))) {
    const before = previousShots.get(shot.id);
    if (!before || (!before.videoAssetVersionId && !before.videoJobId)) continue;
    const job = before.videoJobId ? previousJobs.get(before.videoJobId) : undefined;
    let changed = false;
    try {
      changed = !job || JSON.stringify(motionComicVideoInputFingerprintSource(previous, before, job.providerId, job.model))
        !== JSON.stringify(motionComicVideoInputFingerprintSource(next, shot, job.providerId, job.model));
    } catch {
      changed = true;
    }
    if (changed) result = invalidateMotionComicShotVideo(result, shot.id);
  }
  return result;
}

export function selectedMotionComicVideoAsset(
  document: MotionComicPipelineData,
  shot: Pick<MotionComicShot, 'videoAssetVersionId'>,
): ProductionAssetVersion | undefined {
  return shot.videoAssetVersionId
    ? document.assets.find((asset) => asset.id === shot.videoAssetVersionId && asset.kind === 'video' && asset.localPath?.trim())
    : undefined;
}

function fixedReferenceFingerprint(
  document: MotionComicPipelineData,
  referenceAssetVersionIds: readonly string[],
): MotionComicVideoReferenceFingerprint | null {
  const ids = new Set(referenceAssetVersionIds);
  const references = document.assets.filter((asset) => ids.has(asset.id) && asset.kind === 'image' && asset.localPath?.trim());
  const fixed = references.find((asset) => asset.selected === true && asset.pinned === true)
    ?? [...references].reverse().find((asset) => asset.pinned === true);
  return fixed ? { id: fixed.id, localPath: fixed.localPath, sha256: fixed.sha256 } : null;
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function sha256Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotateRight = (word: number, count: number) => (word >>> count) | (word << (32 - count));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function frameAsset(document: MotionComicPipelineData, id: string | undefined, label: string): ProductionAssetVersion {
  if (!id) throw new Error(`DIRECTOR_VIDEO_FIRST_FRAME_REQUIRED: 请先为当前镜头准备${label}。`);
  const asset = document.assets.find((candidate) => candidate.id === id);
  if (!asset || asset.kind !== 'image' || !asset.localPath?.trim()) {
    throw new Error(`DIRECTOR_VIDEO_FRAME_INVALID: 当前镜头${label}不是可用的本地图片。`);
  }
  return asset;
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}
