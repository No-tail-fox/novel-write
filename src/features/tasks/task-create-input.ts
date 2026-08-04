import type { CreateTaskInput, CustomCoverTemplate } from '../../shared/types';
import { normalizeOrdinaryTaskCoverPageText } from '../../shared/ordinary-task-cover';
import { parseOrdinaryCoverMode, resolveOrdinaryCoverTemplate } from './task-control-manifest';

export function buildTaskCreateInput(
  input: CreateTaskInput,
  coverTemplates: CustomCoverTemplate[],
): CreateTaskInput {
  const coverImageMode = parseOrdinaryCoverMode(input.coverImageMode ?? 'off');
  const coverPageEnabled = input.coverPageEnabled === true;
  const coverPageText = normalizeOrdinaryTaskCoverPageText(input.coverPageText);
  const coverTemplate = resolveOrdinaryCoverTemplate(coverImageMode, input.coverTemplateId, coverTemplates);
  const manualCoverAssetId = input.manualCoverAssetId?.trim();
  if (coverImageMode === 'manual' && !manualCoverAssetId) {
    throw new Error('ORDINARY_MANUAL_COVER_REQUIRED: 请先导入手动封面。');
  }
  if (manualCoverAssetId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(manualCoverAssetId)) {
    throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: 手动封面资产标识无效。');
  }
  if (coverPageEnabled && coverImageMode === 'off') {
    throw new Error('ORDINARY_COVER_PAGE_IMAGE_REQUIRED: 启用封面页后请选择自动生成或手动封面。');
  }
  return {
    ...input,
    keepPromotion: input.keepPromotion === true,
    coverImageMode,
    coverTemplateId: coverTemplate?.id ?? input.coverTemplateId,
    coverPageEnabled,
    coverPageText: coverPageEnabled ? coverPageText : '',
    ...(coverImageMode === 'manual' ? { manualCoverAssetId } : { manualCoverAssetId: undefined }),
  };
}
