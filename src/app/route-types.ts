import type { PublicAppState } from '../shared/config-secrets';
import type { AppMutationResult } from '../shared/types';

export type RendererAppState = PublicAppState;
export type ApplyMutationResult = (result: AppMutationResult | null) => void;
