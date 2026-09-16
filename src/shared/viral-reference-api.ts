import type { AppMutationResult, ViralAnalysisSettings } from './types';
import type { ReferenceManifest, ReferencePart } from './viral-reference';

export interface ViralReferenceEditInput {
  analysisId: string;
  expectedRevision: number;
  partId: string;
  observationId: string;
  text: string;
}

export interface ViralReferenceApi {
  importLocalViralAnalysis(input: { title?: string; settings: ViralAnalysisSettings }): Promise<AppMutationResult | null>;
  analyzePreparedViralAnalysis(id: string): Promise<AppMutationResult | null>;
  getViralReferenceIndex(id: string): Promise<ReferenceManifest | null>;
  getViralReferencePart(id: string, partId: string, expectedRevision: number): Promise<ReferencePart>;
  getViralMediaUrl(id: string, mediaId: string): Promise<string>;
  saveViralReferenceEdit(input: ViralReferenceEditInput): Promise<ReferenceManifest>;
  exportViralReference(input: { analysisId: string; format: 'markdown' | 'json' | 'csv' }): Promise<string | null>;
  configureViralReferenceRun(input: { analysisId: string; maxAnalysisRequests: number; referenceVisualInput: 'frames' | 'video'; referenceAudioInput: boolean; retryReviewedRequests: boolean }): Promise<AppMutationResult | null>;
}
