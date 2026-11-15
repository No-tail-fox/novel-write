import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stageLemoAssets, verifyLemoAssets, readLemoAssetManifest, type LemoAssetInput, type LemoAssetMedia } from './lemo-upstream-assets';
import { piDataHash } from './pi-film-fingerprint';
import type { PiHostOperation } from './pi-agent-tool-router';

/** Reuses the existing immutable material pipeline; no new illustration request is dispatched here. */
export async function stagePiFilmAssets(options: {
  projectRoot: string; previewRoot: string; assets: LemoAssetInput[]; files: Record<string, string>; media: LemoAssetMedia; canvas: { width: number; height: number };
}) {
  await stageLemoAssets({ projectDir: options.projectRoot, previewDir: options.previewRoot, inputs: options.assets, files: options.files, media: options.media, canvas: options.canvas });
  await verifyLemoAssets(options.projectRoot);
  const manifest = await readLemoAssetManifest(options.projectRoot);
  return { manifest, assetHash: piDataHash(manifest) };
}
const viewSchema = z.object({ id: z.string().min(1) }).strict();
export function piViewAssetOperation(options: { projectRoot: string; previewRoot: string; media: LemoAssetMedia }): PiHostOperation {
  return { description: 'Inspect a staged image asset using a host-generated thumbnail.', parameters: z.toJSONSchema(viewSchema), mutates: false,
    execute: async input => {
      const { id } = viewSchema.parse(input);
      const manifest = await readLemoAssetManifest(options.projectRoot);
      const asset = manifest?.assets.find(asset => asset.id === id);
      if (!asset || !asset.file) throw new Error('PI_IMAGE_ASSET_MISSING');
      await verifyLemoAssets(options.projectRoot);
      const file = join(options.previewRoot, encodeURIComponent(id) + '.jpg');
      await options.media.thumbnail(join(options.projectRoot, asset.file), file);
      const image = await readFile(file);
      if (image.length > 5 * 1024 * 1024) throw new Error('PI_IMAGE_PREVIEW_SIZE');
      return { content: [{ type: 'image', data: image.toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: JSON.stringify({ id, description: asset.description }) }] };
    } };
}
