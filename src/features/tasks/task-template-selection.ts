export interface TaskTemplateIdentity {
  id: string;
}

export interface TaskTemplateSelection<T extends TaskTemplateIdentity> {
  appliedTemplateId: string;
  candidateTemplateId: string;
  appliedTemplate: T | null;
  candidateTemplate: T | null;
  appliedTemplateMissing: boolean;
  canApply: boolean;
}

export function resolveTaskTemplateSelection<T extends TaskTemplateIdentity>(
  templates: readonly T[],
  appliedTemplateId: string,
  candidateTemplateId: string,
): TaskTemplateSelection<T> {
  const appliedId = appliedTemplateId.trim();
  const candidateId = candidateTemplateId.trim() || appliedId;
  const appliedTemplate = templates.find((template) => template.id === appliedId) ?? null;
  const candidateTemplate = templates.find((template) => template.id === candidateId) ?? null;

  return {
    appliedTemplateId: appliedId,
    candidateTemplateId: candidateId,
    appliedTemplate,
    candidateTemplate,
    appliedTemplateMissing: appliedId.length > 0 && !appliedTemplate,
    canApply: Boolean(candidateTemplate && candidateId !== appliedId),
  };
}
