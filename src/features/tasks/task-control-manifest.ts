import { CUSTOM_COVER_TEMPLATE_FIELDS } from '../../shared/editorial-data-contracts';
import type { CustomCoverTemplate, Task } from '../../shared/types';

export const ORDINARY_COVER_MODE_MANIFEST = {
  off: { label: '关闭', available: true },
  auto: { label: '自动', available: true },
  manual: { label: '手动封面', available: false },
} as const;

export type OrdinaryCoverMode = keyof typeof ORDINARY_COVER_MODE_MANIFEST;

export const ORDINARY_AVAILABLE_COVER_MODES = (Object.keys(ORDINARY_COVER_MODE_MANIFEST) as OrdinaryCoverMode[])
  .filter((mode) => ORDINARY_COVER_MODE_MANIFEST[mode].available);

export function parseOrdinaryCoverMode(value: unknown): OrdinaryCoverMode {
  if (typeof value === 'string' && value in ORDINARY_COVER_MODE_MANIFEST) {
    return value as OrdinaryCoverMode;
  }
  throw new Error(`ORDINARY_COVER_MODE_INVALID: Unsupported ordinary cover mode: ${String(value)}`);
}

export function resolveOrdinaryCoverTemplate(
  modeInput: unknown,
  templateId: string | null | undefined,
  templates: CustomCoverTemplate[],
): CustomCoverTemplate | null {
  const mode = parseOrdinaryCoverMode(modeInput ?? 'off');
  if (mode === 'off') return null;
  if (mode === 'manual') {
    throw new Error('ORDINARY_MANUAL_COVER_UNAVAILABLE: 手动封面暂不可用，请先使用关闭或自动封面。');
  }
  const selected = templates.find((template) => template.id === templateId);
  if (!selected) {
    throw new Error(`ORDINARY_COVER_TEMPLATE_NOT_FOUND: Cover template does not exist: ${templateId ?? ''}`);
  }
  for (const field of Object.keys(CUSTOM_COVER_TEMPLATE_FIELDS) as Array<keyof CustomCoverTemplate>) {
    if (typeof selected[field] !== 'string' || selected[field].trim().length === 0) {
      throw new Error(`ORDINARY_COVER_TEMPLATE_INVALID: Cover template field is empty: ${field}`);
    }
  }
  return selected;
}

export function isOrdinaryTask(task: Pick<Task, 'taskKind' | 'taskType'>): boolean {
  return (task.taskType ?? task.taskKind) === 'story';
}
