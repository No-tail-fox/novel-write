import { z } from 'zod';

export const librarySourceSchema = z.object({
  kind: z.enum(['local', 'image-lab', 'copy-studio', 'conversation', 'motion-comic']),
  id: z.string().max(256).optional(),
  label: z.string().max(240).optional(),
}).strict();
const metadataShape = {
  title: z.string().trim().min(1).max(240),
  collection: z.string().trim().max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  favorite: z.boolean(),
};
export const librarySaveSchema = z.discriminatedUnion('kind', [
  z.object({ ...metadataShape, kind: z.literal('image'), imagePath: z.string().trim().min(1).max(4096), prompt: z.string().max(65_536).optional(), source: librarySourceSchema }).strict(),
  z.object({ ...metadataShape, kind: z.literal('text'), text: z.string().trim().min(1).max(65_536), source: librarySourceSchema }).strict(),
]);
export const libraryUpdateSchema = z.object({ id: z.uuid(), ...metadataShape }).strict();
export const libraryListSchema = z.object({
  kind: z.enum(['image', 'text']).optional(),
  query: z.string().max(240).optional(),
  collection: z.string().max(80).optional(),
  favorite: z.boolean().optional(),
  deleted: z.boolean().optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();
export type LibrarySaveInput = z.infer<typeof librarySaveSchema>;
export type LibraryUpdateInput = z.infer<typeof libraryUpdateSchema>;
export type LibraryListInput = z.infer<typeof libraryListSchema>;
export type LibrarySource = z.infer<typeof librarySourceSchema>;
export type LibraryKind = 'image' | 'text';
export interface LibraryAsset {
  id: string;
  kind: LibraryKind;
  title: string;
  collection: string;
  tags: string[];
  favorite: boolean;
  source: LibrarySource;
  revision: string;
  imagePath?: string;
  text?: string;
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export type LibraryAssetSummary = Omit<LibraryAsset, 'text' | 'prompt'> & { preview: string };
export interface LibraryPage {
  items: LibraryAssetSummary[];
  total: number;
  collections: string[];
}
export function summarizeLibraryAsset(asset: LibraryAsset): LibraryAssetSummary {
  const { text, prompt, ...metadata } = asset;
  return { ...metadata, preview: (text || prompt || '').slice(0, 240) };
}
export function queryLibraryAssets(assets: LibraryAsset[], request: LibraryListInput = {}): LibraryPage {
  const query = request.query?.trim().toLocaleLowerCase();
  const items = assets.filter((asset) => Boolean(asset.deletedAt) === Boolean(request.deleted))
    .filter((asset) => !request.kind || asset.kind === request.kind)
    .filter((asset) => request.collection === undefined || asset.collection === request.collection)
    .filter((asset) => !request.favorite || asset.favorite)
    .filter((asset) => !query || [asset.title, asset.collection, ...asset.tags, asset.text, asset.prompt].join('\n').toLocaleLowerCase().includes(query))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  return {
    items: items.slice(request.offset ?? 0, (request.offset ?? 0) + (request.limit ?? 60)).map(summarizeLibraryAsset),
    total: items.length,
    collections: [...new Set(assets.filter((asset) => Boolean(asset.deletedAt) === Boolean(request.deleted)).map((asset) => asset.collection).filter(Boolean))].sort(),
  };
}
