import { AppError } from './app-error';
import { normalizeDraftTemplate } from './templates';
import type { DraftTemplate, HtmlVideoJobConfig } from './types';

export interface ResolveHtmlVideoDraftForRenderInput {
  config: HtmlVideoJobConfig;
  resolveTemplate: (id: string) => Promise<DraftTemplate | null>;
}

export async function resolveHtmlVideoDraftForRender(
  input: ResolveHtmlVideoDraftForRenderInput,
): Promise<DraftTemplate | undefined> {
  const templateId = input.config.draftTemplate?.trim();
  if (!templateId) return undefined;
  const template = await input.resolveTemplate(templateId);
  if (!template) {
    throw new AppError(
      'HTML_VIDEO_DRAFT_TEMPLATE_MISSING',
      `HTML video draft template is missing: ${templateId}`,
      true,
    );
  }
  return normalizeDraftTemplate(template);
}
