import { z } from 'zod';

export const STOCK_MEDIA_SECRET_ID = 'stockMedia/pexels/apiKey' as const;
export const PEXELS_LICENSE_URL = 'https://www.pexels.com/license/';
export const PEXELS_API_DOCUMENTATION_URL = 'https://www.pexels.com/api/documentation/';
const operationId = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
export const stockMediaSearchSchema = z.object({
  operationId, provider: z.literal('pexels'), type: z.literal('video'),
  query: z.string().trim().min(1).max(200),
  orientation: z.enum(['any', 'landscape', 'portrait', 'square']).default('any'),
  minDurationSec: z.number().min(0).max(600).default(0),
  maxDurationSec: z.number().positive().max(600).optional(),
  page: z.number().int().min(1).max(1000).default(1),
  perPage: z.number().int().min(1).max(24).default(12),
}).strict().refine(value => value.maxDurationSec === undefined || value.maxDurationSec >= value.minDurationSec, { message: '最大时长不能短于最小时长' });
export const stockMediaImportSchema = z.object({
  operationId, provider: z.literal('pexels'),
  mediaId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  variantId: z.string().regex(/^[1-9][0-9]{0,15}$/),
}).strict();
export const stockMediaCancelSchema = z.object({ operationId }).strict();
export type StockMediaSearchInput = z.input<typeof stockMediaSearchSchema>;
export type StockMediaImportInput = z.infer<typeof stockMediaImportSchema>;
export interface StockMediaVariant { id: string; width: number; height: number; mimeType: 'video/mp4'; downloadUrl: string }
export interface StockMediaItem {
  provider: 'pexels'; type: 'video'; id: string; sourceUrl: string;
  author: string; authorUrl: string; previewUrl: string;
  width: number; height: number; durationMs: number; variants: StockMediaVariant[];
  license: { name: 'Pexels License'; url: string; recordedAt: string };
}
export interface StockMediaSearchResult {
  items: StockMediaItem[]; page: number; perPage: number; total: number; hasMore: boolean;
  /** Duration filtering happens on this result page, not over the entire provider catalog. */
  durationFiltered: boolean;
}
export const stockMediaProvenanceSchema = z.object({
  provider: z.literal('pexels'), mediaId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  variantId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  sourceUrl: z.url().startsWith('https://www.pexels.com/'),
  author: z.string().min(1).max(300), authorUrl: z.url().startsWith('https://www.pexels.com/'),
  licenseName: z.literal('Pexels License'), licenseUrl: z.literal(PEXELS_LICENSE_URL),
  licenseRecordedAt: z.iso.datetime(), downloadedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  apiDocumentationUrl: z.literal(PEXELS_API_DOCUMENTATION_URL),
}).strict();
export type StockMediaProvenance = z.infer<typeof stockMediaProvenanceSchema>;
export interface StockMediaImportResult {
  path: string; width: number; height: number; durationMs: number; bytes: number;
  provenance: StockMediaProvenance; reused: boolean;
}
export interface StockMediaStatus { provider: 'pexels'; configured: boolean }
export interface StockMediaApi {
  getStockMediaStatus: () => Promise<StockMediaStatus>;
  searchStockMedia: (input: StockMediaSearchInput) => Promise<StockMediaSearchResult>;
  importStockMedia: (input: StockMediaImportInput) => Promise<StockMediaImportResult>;
  cancelStockMedia: (input: { operationId: string }) => Promise<void>;
}
