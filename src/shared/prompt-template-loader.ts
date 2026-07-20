import type { PromptTemplate } from './types';

interface PromptTemplateDefaultsModule {
  defaultPromptTemplates: PromptTemplate[];
}

export function createRetryablePromptTemplateLoader(
  loadModule: () => Promise<PromptTemplateDefaultsModule>,
): () => Promise<PromptTemplate[]> {
  let defaultPromptTemplatesPromise: Promise<PromptTemplate[]> | null = null;
  return () => {
    defaultPromptTemplatesPromise ??= loadModule()
      .then((module) => module.defaultPromptTemplates)
      .catch((error) => {
        defaultPromptTemplatesPromise = null;
        throw error;
      });
    return defaultPromptTemplatesPromise;
  };
}

export const loadDefaultPromptTemplates = createRetryablePromptTemplateLoader(
  () => import('./prompt-template-defaults'),
);
