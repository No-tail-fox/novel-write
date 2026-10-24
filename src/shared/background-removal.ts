import type {
  BackgroundRemovalMetadata,
  BackgroundRemovalMethod,
  BackgroundRemovalQuality,
} from './types';
import type { EditorialBitmapAlphaMetrics } from './editorial-cutout';

export const BACKGROUND_REMOVAL_ERROR_CODES = {
  invalidSource: 'BACKGROUND_REMOVAL_SOURCE_INVALID',
  modelInvalid: 'BACKGROUND_REMOVAL_MODEL_INVALID',
  modelDownloadFailed: 'BACKGROUND_REMOVAL_MODEL_DOWNLOAD_FAILED',
  modelMissing: 'BACKGROUND_REMOVAL_MODEL_MISSING',
  workerMissing: 'BACKGROUND_REMOVAL_WORKER_MISSING',
  outputInvalid: 'BACKGROUND_REMOVAL_OUTPUT_INVALID',
  emptyForeground: 'BACKGROUND_REMOVAL_EMPTY_FOREGROUND',
  notIsolated: 'BACKGROUND_REMOVAL_NOT_ISOLATED',
  workerFailed: 'BACKGROUND_REMOVAL_WORKER_FAILED',
} as const;

export interface BackgroundRemovalAssessment extends EditorialBitmapAlphaMetrics {
  quality: BackgroundRemovalQuality;
  errorCode?: string;
}

/**
 * Assess alpha coverage without pretending that every PNG is a usable cutout.
 * Small transparent corners are a warning; a real subject needs clear space and
 * a meaningful opaque region to be safe for editorial compositing.
 */
export function assessBackgroundRemovalAlpha(metrics: EditorialBitmapAlphaMetrics): BackgroundRemovalAssessment {
  const { transparentFraction, foregroundFraction, edgeFraction } = metrics;
  if ([transparentFraction, foregroundFraction, edgeFraction].some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || Math.abs(transparentFraction + foregroundFraction + edgeFraction - 1) > 0.001) {
    return {
      transparentFraction: 0,
      foregroundFraction: 0,
      edgeFraction: 0,
      quality: 'failed',
      errorCode: BACKGROUND_REMOVAL_ERROR_CODES.outputInvalid,
    };
  }
  if (foregroundFraction < 0.01) {
    return { ...metrics, quality: 'failed', errorCode: BACKGROUND_REMOVAL_ERROR_CODES.emptyForeground };
  }
  if (transparentFraction < 0.02) {
    return { ...metrics, quality: 'warning', errorCode: 'BACKGROUND_REMOVAL_TRANSPARENCY_LOW' };
  }
  if (transparentFraction < 0.05 || edgeFraction > 0.28) {
    return { ...metrics, quality: 'warning', errorCode: 'BACKGROUND_REMOVAL_EDGE_REVIEW' };
  }
  return { ...metrics, quality: 'passed' };
}

export function backgroundRemovalMetadataFromAlpha(
  method: BackgroundRemovalMethod,
  metrics: EditorialBitmapAlphaMetrics,
  options: Pick<BackgroundRemovalMetadata, 'sourceSha256' | 'outputSha256' | 'model' | 'modelVersion' | 'modelSha256'> = {},
): BackgroundRemovalMetadata {
  const assessment = assessBackgroundRemovalAlpha(metrics);
  return {
    method,
    ...options,
    transparentFraction: assessment.transparentFraction,
    foregroundFraction: assessment.foregroundFraction,
    edgeFraction: assessment.edgeFraction,
    quality: assessment.quality,
    ...(assessment.errorCode ? { errorCode: assessment.errorCode } : {}),
  };
}

export function backgroundRemovalFailure(
  method: BackgroundRemovalMethod,
  errorCode: string,
  errorMessage: string,
  options: Pick<BackgroundRemovalMetadata, 'sourceSha256' | 'model' | 'modelVersion' | 'modelSha256'> = {},
): BackgroundRemovalMetadata {
  return {
    method,
    ...options,
    transparentFraction: 0,
    foregroundFraction: 0,
    edgeFraction: 0,
    quality: 'failed',
    errorCode,
    errorMessage,
  };
}

export function isUsableBackgroundRemoval(metadata: BackgroundRemovalMetadata | undefined): boolean {
  return metadata?.quality === 'passed' && metadata.foregroundFraction >= 0.01 && metadata.transparentFraction >= 0.02;
}