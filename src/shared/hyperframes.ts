import type { HtmlVideoClipInfo } from './types';

export const MAX_HYPERFRAMES_SOURCE_BYTES = 1_000_000;
export const GSAP_RUNTIME_FILENAME = 'gsap.min.js';
export const HYPERFRAMES_RUNTIME_FILENAME = 'hyperframe.runtime.gsap.iife.js';

export function hyperframesSourceByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

export function assertHyperframesSource(source: string): void {
  if (!source.trim()) throw new Error('HYPERFRAMES_SOURCE_EMPTY: HTML 源码不能为空。');
  if (source.includes('\0')) throw new Error('HYPERFRAMES_SOURCE_INVALID: HTML 源码包含非法空字符。');
  if (hyperframesSourceByteLength(source) > MAX_HYPERFRAMES_SOURCE_BYTES) {
    throw new Error(`HYPERFRAMES_SOURCE_TOO_LARGE: HTML 源码不能超过 ${MAX_HYPERFRAMES_SOURCE_BYTES} 字节。`);
  }
}

export function getVisibleHtmlVideoTrackIndices(
  clips: readonly Pick<HtmlVideoClipInfo, 'trackIndex'>[],
): number[] {
  const indices = clips.map(({ trackIndex }) => Math.max(0, Math.round(trackIndex)));
  return indices.length ? [...new Set(indices)].sort((left, right) => left - right) : [0];
}

export function moveHtmlVideoClipTrack(
  currentTrackIndex: number,
  rowOffset: number,
  visibleTrackIndices: readonly number[],
): number {
  const currentRow = Math.max(0, visibleTrackIndices.indexOf(currentTrackIndex));
  const targetRow = Math.max(0, Math.min(visibleTrackIndices.length - 1, currentRow + rowOffset));
  return visibleTrackIndices[targetRow] ?? Math.max(0, Math.round(currentTrackIndex));
}

export function clampHtmlVideoMediaTrimStartDelta(
  clip: Pick<HtmlVideoClipInfo, 'startSec' | 'durationSec' | 'mediaStartSec'>,
  deltaSec: number,
): number {
  const boundedMinimum = Math.max(-clip.startSec, -(clip.mediaStartSec ?? 0));
  const minDelta = boundedMinimum === 0 ? 0 : boundedMinimum;
  const maxDelta = Math.max(0, clip.durationSec - 0.1);
  return Math.min(maxDelta, Math.max(minDelta, deltaSec));
}
