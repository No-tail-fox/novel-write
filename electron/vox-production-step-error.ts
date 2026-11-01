import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';

/** Persist received source even when the final paid outcome is still unknown. */
export class VoxProductionStepError extends Error {
  constructor(message: string, readonly document: EditorialCollagePipelineData, readonly outcomeKnown = true) { super(message); }
}
