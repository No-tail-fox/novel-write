import { z } from 'zod';

export const directorTransitionSchema = z.object({
  type: z.enum(['cut', 'dissolve']),
  durationMs: z.number().finite().int().min(0).max(500),
}).strict();
export type DirectorTransition = z.infer<typeof directorTransitionSchema>;
export const DEFAULT_EDITORIAL_TRANSITION: Readonly<DirectorTransition> = { type: 'dissolve', durationMs: 200 };

/** The incoming visual transition never changes the authored audio/scene clock. */
export function resolveDirectorTransition(value?: DirectorTransition): DirectorTransition {
  const result = value ?? DEFAULT_EDITORIAL_TRANSITION;
  return result.type === 'cut' || result.durationMs === 0 ? { type: 'cut', durationMs: 0 } : { ...result };
}
