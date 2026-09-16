import type { ReferenceObservation, ReferenceTimeRange, ReferenceTranscriptSegment } from './viral-reference';
import type { ViralTranscriptSegment } from './types';

export interface ReferenceUnitInput {
  unitId: string;
  range: ReferenceTimeRange;
  contextRange?: ReferenceTimeRange;
  frames: Array<{ mediaId: string; path: string; timeMs: number }>;
  videoPath: string;
  audioPath?: string;
  transcript: ReferenceTranscriptSegment[];
}

export type ReferenceObservationDraft = Pick<ReferenceObservation, 'track' | 'text' | 'state' | 'presence'> & {
  aspect?: ReferenceObservation['aspect'];
};

export interface ReferenceSummary {
  overview: string;
  narrative: string;
  rhythm: string;
  productionRules: string[];
  limitations: string[];
}

export interface ReferenceProviders {
  /** Stable, credential-free model/endpoint/capability fingerprint. */
  fingerprint: string;
  fingerprints?: Partial<Record<'visual' | 'audio' | 'transcribe' | 'summary', string>>;
  visualMode: 'frames' | 'video';
  analyzeVisual?: (input: ReferenceUnitInput, signal?: AbortSignal) => Promise<ReferenceObservationDraft[]>;
  analyzeAudio?: (input: ReferenceUnitInput, signal?: AbortSignal) => Promise<ReferenceObservationDraft[]>;
  transcribe?: (audioPath: string, signal?: AbortSignal) => Promise<ViralTranscriptSegment[]>;
  summarize?: (input: { summaries: string[]; partial: boolean }, signal?: AbortSignal) => Promise<ReferenceSummary>;
}
