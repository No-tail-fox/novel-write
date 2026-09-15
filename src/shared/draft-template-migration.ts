import { draftTemplates, legacyDefaultDraftTemplate, normalizeDraftTemplate } from './templates';
import type { DraftTemplate } from './types';

function equalTemplateValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.hasOwn(rightRecord, key) && equalTemplateValue(leftRecord[key], rightRecord[key]));
}

function isUnmodifiedLegacyDefault(template: Partial<DraftTemplate>): boolean {
  // Timestamps describe persistence, not an edit. Compare every authored field before
  // normalization so missing fields or user changes cannot be mistaken for the old preset.
  const { updatedAt: _updatedAt, ...content } = template;
  const { updatedAt: _legacyUpdatedAt, ...legacyContent } = legacyDefaultDraftTemplate;
  return equalTemplateValue(content, legacyContent);
}

export function builtinDraftTemplateUpdates(storedTemplates: readonly Partial<DraftTemplate>[]): DraftTemplate[] {
  const storedById = new Map(storedTemplates.map((template) => [template.id, template]));
  return draftTemplates.filter((builtin) => {
    const stored = storedById.get(builtin.id);
    return !stored || (builtin.id === legacyDefaultDraftTemplate.id && isUnmodifiedLegacyDefault(stored));
  });
}

export function reconcileBuiltinDraftTemplates(storedTemplates: readonly Partial<DraftTemplate>[] = []): DraftTemplate[] {
  const updates = new Map(builtinDraftTemplateUpdates(storedTemplates).map((template) => [template.id, template]));
  const reconciled = storedTemplates.map((stored) => {
    const template = updates.get(stored.id ?? '') ?? stored;
    updates.delete(stored.id ?? '');
    return normalizeDraftTemplate(template);
  });
  return [...reconciled, ...Array.from(updates.values(), normalizeDraftTemplate)];
}
