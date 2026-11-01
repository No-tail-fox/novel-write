import { z } from 'zod';
import { lemoCreativeTextSchema, lemoResponseTextSchema, checkLemoPayloadResource } from './creative-text';
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const lemoMaterialSchema = z.object({
  id: key, kind: z.enum(['generated', 'existing', 'evidence']), description: lemoCreativeTextSchema,
  prompt: lemoResponseTextSchema.optional(), assetId: z.string().max(256).optional(),
}).strict().superRefine(checkLemoPayloadResource);
export type LemoMaterial = z.infer<typeof lemoMaterialSchema>;
