import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { voxInputHash } from './vox-production-service';

/**
 * Per-node VOX checkpoint receipt (`vox-production/<requestId>/result.json`).
 *
 * v2 stores only the content hash of the pre-node document plus the node result. The legacy format
 * stored the whole pre-node document as `before` (~100–120 KB per node); it is still read so older
 * projects resume exactly as before.
 */
export interface VoxProductionReceipt {
  version: 2;
  beforeHash: string;
  result: EditorialCollagePipelineData;
}

/** Hash of the document content resume compares: everything except the production journal and revision. */
export function voxReceiptContentHash(document: EditorialCollagePipelineData): string {
  const { productionRun: _run, updatedAt: _revision, ...content } = document;
  return voxInputHash(content);
}

export function createVoxProductionReceipt(before: EditorialCollagePipelineData, result: EditorialCollagePipelineData): VoxProductionReceipt {
  return { version: 2, beforeHash: voxReceiptContentHash(before), result };
}

/** The input hash recorded by a receipt of either format. */
export function voxReceiptBeforeHash(receipt: unknown): string {
  const value = receipt as { version?: unknown; beforeHash?: unknown; before?: unknown } | null;
  if (value && value.version === 2 && typeof value.beforeHash === 'string') return value.beforeHash;
  if (value && value.before && typeof value.before === 'object') return voxReceiptContentHash(value.before as EditorialCollagePipelineData);
  throw new Error('VOX_RECEIPT_INVALID: 节点回执缺少输入校验信息。');
}
