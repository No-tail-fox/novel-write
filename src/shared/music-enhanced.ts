import { z } from 'zod';
export const musicEnhancedRequestSchema = z.discriminatedUnion('action', [
  z.object({action:z.literal('list')}).strict(),
  z.object({action:z.literal('submit'),audioPath:z.string().trim().min(1).max(4096),title:z.string().trim().max(200)}).strict(),
  z.object({action:z.literal('poll'),id:z.string().uuid()}).strict(),
  z.object({action:z.literal('cancel'),id:z.string().uuid()}).strict(),
]);
export type MusicEnhancedRequest = z.infer<typeof musicEnhancedRequestSchema>;
export interface MusicEnhancedJob { id:string; taskId:number; title:string; status:string; progress:number; stage:string; songId:string; error:string; createdAt:string; }
