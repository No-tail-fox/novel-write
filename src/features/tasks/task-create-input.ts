import type { CreateTaskInput, CustomCoverTemplate } from '../../shared/types';
import { parseOrdinaryCoverMode, resolveOrdinaryCoverTemplate } from './task-control-manifest';

export function buildTaskCreateInput(
  input: CreateTaskInput,
  coverTemplates: CustomCoverTemplate[],
): CreateTaskInput {
  const coverImageMode = parseOrdinaryCoverMode(input.coverImageMode ?? 'off');
  const coverTemplate = resolveOrdinaryCoverTemplate(coverImageMode, input.coverTemplateId, coverTemplates);
  return {
    ...input,
    keepPromotion: input.keepPromotion === true,
    coverImageMode,
    coverTemplateId: coverTemplate?.id ?? input.coverTemplateId,
  };
}
