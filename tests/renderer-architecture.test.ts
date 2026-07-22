import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { styleLabel } from '../src/features/tasks/task-formatters';
import { styleOptions } from '../src/shared/editorial-options';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8').catch(() => '');
}

describe('renderer shared control architecture', () => {
  it('moves every shared form control into one owner module', async () => {
    const files = await Promise.all([
      source('src/components/FormField.tsx'),
      source('src/components/SegmentedControl.tsx'),
      source('src/components/ToggleField.tsx'),
      source('src/components/RangeField.tsx'),
      source('src/components/OptionGroup.tsx'),
      source('src/components/Accordion.tsx'),
    ]);
    files.forEach((file) => expect(file.length).toBeGreaterThan(0));

    const main = await source('src/main.tsx');
    for (const definition of ['function Field(', 'function Segmented(', 'function ToggleField(', 'function RangeField(', 'function OptionCloud(', 'function Accordion(']) {
      expect(main).not.toContain(definition);
    }
  });

  it('keeps the field class hook and natively disables every grouped descendant', async () => {
    const [field, css] = await Promise.all([
      source('src/components/FormField.tsx'),
      source('src/styles.css'),
    ]);
    expect(field).toContain('className="field form-field"');
    expect(field).toContain('label: string');
    expect(field).toContain('hint?: string');
    expect(field).toContain('disabled?: boolean');
    expect(field).toContain('<fieldset');
    expect(field).toContain('<legend');
    expect(field).toContain('disabled={disabled}');
    expect(field).not.toContain('<label');
    expect(css).toContain('.form-field {');
    expect(css).toContain('.field > .form-field-label');
    expect(css).toContain('.form-field-label {\n  padding: 0;\n}');
  });

  it('provides a typed, labelled segmented group with native focus and disabled behavior', async () => {
    const segmented = await source('src/components/SegmentedControl.tsx');
    expect(segmented).toContain('SegmentedControl<T extends string>');
    expect(segmented).toContain('role="group"');
    expect(segmented).toContain('aria-label={label}');
    expect(segmented).toContain('aria-pressed={option === value}');
    expect(segmented).toContain('disabled={disabled}');
    expect(segmented).toContain('className="segmented"');
    expect(segmented).toContain('type="button"');
  });

  it('keeps toggle and range hooks while labelling every native input', async () => {
    const [toggle, range] = await Promise.all([
      source('src/components/ToggleField.tsx'),
      source('src/components/RangeField.tsx'),
    ]);
    for (const hook of ['draft-toggle-row', 'draft-toggle-field draft-toggle-control', 'draft-toggle-box']) {
      expect(toggle).toContain(hook);
    }
    expect(toggle).toContain('type="checkbox"');
    expect(toggle).toContain('aria-label={label}');
    expect(toggle).toContain('disabled={disabled}');
    expect(range).toContain('className="draft-range-field"');
    expect(range).toContain('type="range"');
    expect(range).toContain('type="number"');
    expect(range).toContain('aria-label={`${label}滑块`}');
    expect(range).toContain('aria-label={`${label}数值`}');
    const nativeInputs = range.match(/<input[\s\S]*?\/>/gu) ?? [];
    expect(nativeInputs).toHaveLength(2);
    nativeInputs.forEach((input) => expect(input).toContain('disabled={disabled}'));
  });

  it('provides a typed option group with explicit selection and disabled semantics', async () => {
    const options = await source('src/components/OptionGroup.tsx');
    expect(options).toContain('OptionGroup<T extends string>');
    expect(options).toContain('readonly (readonly [T, string, string?])[]');
    expect(options).not.toContain('as T');
    expect(options).toContain('role="group"');
    expect(options).toContain('aria-label={title}');
    expect(options).toContain('aria-pressed={value === id}');
    expect(options).toContain('disabled={disabled}');
    expect(options).toContain('className="option-cloud"');
    expect(options).toContain('type="button"');
  });

  it('owns accordion disclosure relationships and native disabled behavior', async () => {
    const accordion = await source('src/components/Accordion.tsx');
    expect(accordion).toContain('useId');
    expect(accordion).toContain("expanded ? 'accordion open' : 'accordion'");
    expect(accordion).toContain('aria-expanded={expanded}');
    expect(accordion).toContain('aria-controls={panelId}');
    expect(accordion).toContain('aria-labelledby={buttonId}');
    expect(accordion).toContain('disabled={disabled}');
    expect(accordion).toContain('type="button"');
  });
});

describe('renderer shared feedback and data architecture', () => {
  it('moves every feedback and data primitive into one owner module', async () => {
    const paths = [
      'src/components/AsyncActionFeedback.tsx',
      'src/components/ErrorDetails.tsx',
      'src/components/StatusBadge.tsx',
      'src/components/EmptyState.tsx',
      'src/components/EventTimeline.tsx',
      'src/components/ConfirmDialog.tsx',
      'src/components/CursorPagination.tsx',
      'src/components/DataTable.tsx',
    ];
    const files = await Promise.all(paths.map(source));
    files.forEach((file) => expect(file.length).toBeGreaterThan(0));

    const main = await source('src/main.tsx');
    for (const definition of ['function InlineActionFeedback(', 'function ErrorSummaryButton(', 'function ErrorDetailDialog(', 'function StatusPill(', 'function EmptyState(', 'function EventTimeline(']) {
      expect(main).not.toContain(definition);
    }
  });

  it('keeps real feedback, error, loading, and status semantics', async () => {
    const [feedback, errors, status, empty] = await Promise.all([
      source('src/components/AsyncActionFeedback.tsx'),
      source('src/components/ErrorDetails.tsx'),
      source('src/components/StatusBadge.tsx'),
      source('src/components/EmptyState.tsx'),
    ]);
    expect(feedback).toContain("feedback.tone === 'error' ? 'alert' : 'status'");
    expect(errors).toContain('aria-modal="true"');
    expect(errors).toContain('aria-labelledby={titleId}');
    expect(errors).toContain('aria-describedby={descriptionId}');
    expect(errors).toContain('type="button"');
    expect(status).toContain('status-pill ${status}');
    for (const variant of ['completed', 'running', 'failed', 'cancelled', 'paused', 'draft']) {
      expect(status).toContain(`${variant}:`);
    }
    expect(empty).toContain("tone === 'loading'");
    expect(empty).toContain("tone === 'error'");
    expect(empty).toContain("role={tone === 'error' ? 'alert' : 'status'}");
  });

  it('provides semantic fixed-layout pagination and table anatomy', async () => {
    const [pagination, table, css] = await Promise.all([
      source('src/components/CursorPagination.tsx'),
      source('src/components/DataTable.tsx'),
      source('src/styles.css'),
    ]);
    for (const label of ['上一页', '重新加载', '下一页']) expect(pagination).toContain(label);
    expect(pagination).toContain('disabled={busy || !hasPrevious}');
    expect(pagination).toContain('disabled={busy || !hasNext}');
    expect(table).toContain('role="table"');
    expect(table).toContain('role="columnheader"');
    expect(table).toContain('role="rowgroup"');
    expect(table).toContain('state?: ReactNode');
    expect(table).toContain('aria-colspan={columns.length}');
    expect(css).toContain('grid-template-columns: repeat(3, 32px)');
    expect(css).toContain('min-height: 120px');
  });

  it('owns labelled confirmation dialog focus and submission contracts', async () => {
    const dialog = await source('src/components/ConfirmDialog.tsx');
    expect(dialog).toContain('nextDialogFocusIndex');
    expect(dialog).toContain('createConfirmSubmissionGuard');
    expect(dialog).toContain('aria-labelledby={titleId}');
    expect(dialog).toContain('aria-describedby={descriptionId}');
    expect(dialog).toContain("event.key === 'Escape'");
    expect(dialog).toContain("event.key !== 'Tab'");
    expect(dialog).toContain('previouslyFocused?.focus()');
    expect(dialog).toContain('disabled={busy || submitting}');
    expect(dialog).toContain('tabIndex={-1}');
    expect(dialog).toContain('focusable.length === 0');
    expect(dialog).toContain('dialogRef.current?.focus()');
    expect(dialog).toContain('if (open && (busy || submitting)) dialogRef.current?.focus();');
  });
});

describe('renderer application ownership architecture', () => {
  it('isolates state and browser fallback without importing React pages', async () => {
    const [appState, fallback, main] = await Promise.all([
      source('src/app/app-state.ts'),
      source('src/app/browser-fallback.ts'),
      source('src/main.tsx'),
    ]);
    expect(appState.length).toBeGreaterThan(0);
    expect(fallback.length).toBeGreaterThan(0);
    expect(appState).not.toContain("from '../main'");
    expect(appState).not.toContain("from 'react'");
    expect(fallback).not.toContain("from '../main'");
    expect(fallback).not.toContain("from 'react'");
    for (const symbol of ['initialState', 'hydrateState', 'bootstrapToState', 'mergeDeltaView', 'registerHistoryDeltaBarrier']) {
      expect(appState).toContain(`export ${symbol === 'initialState' ? 'const' : 'function'} ${symbol}`);
    }
    expect(fallback).toContain("fallbackGovernanceStorageKey = 'storydream-history-governance-v1'");
    expect(fallback).toContain('export function makeFallbackApi');
    expect(main).not.toContain('function makeFallbackApi(');
  });

  it('owns one new-task action and exactly fifteen sidebar entries', async () => {
    const navigation = await import('../src/app/navigation');
    expect(navigation.newTaskPrimaryAction.view).toBe('new-task');
    expect(navigation.sidebarNavItems).toHaveLength(15);
    expect(new Set(navigation.sidebarNavItems.map((item) => item.view)).size).toBe(15);
    expect(navigation.navigationItems).toHaveLength(16);
    expect(navigation.navigationItemForView('task-detail')).toMatchObject({ label: '任务详情', hint: '单任务流水线' });
  });

  it('keeps route state public and feature-neutral', async () => {
    const routes = await source('src/app/route-types.ts');
    expect(routes).toContain("import type { PublicAppState } from '../shared/config-secrets'");
    expect(routes).toContain('export type RendererAppState = PublicAppState');
    expect(routes).not.toMatch(/\bAppState\b/u);
    expect(routes).not.toContain('apiKey');
    expect(routes).not.toContain('secretStatus: Record');
  });

  it('moves shared editorial catalogs into one JSX-free owner', async () => {
    const [options, main] = await Promise.all([
      source('src/shared/editorial-options.ts'),
      source('src/main.tsx'),
    ]);
    for (const symbol of ['contentTracks', 'styleOptions', 'ratioOptions', 'smartImageModeOptions', 'pauseOptions', 'rewriteOptions', 'promptTemplateVariableDefinitions']) {
      expect(options).toContain(`export const ${symbol}`);
      expect(main).not.toContain(`const ${symbol}`);
    }
    expect(options).not.toContain('<div');
    expect(options).not.toContain('<button');
    expect(options).not.toContain('React.');
  });
});

describe('task feature ownership architecture', () => {
  it('retains every built-in editorial label when the custom style catalog is empty', () => {
    for (const [id, label] of styleOptions) {
      expect(styleLabel(id, [])).toBe(label);
    }
  });

  it('owns every task page and pure helper in a dedicated module', async () => {
    const paths = [
      'src/features/tasks/NewTaskPage.tsx',
      'src/features/tasks/QueuePage.tsx',
      'src/features/tasks/HistoryPage.tsx',
      'src/features/tasks/TaskDetailPage.tsx',
      'src/features/tasks/TaskArtifactPreview.tsx',
      'src/features/tasks/task-pipeline.ts',
      'src/features/tasks/task-formatters.ts',
    ];
    const files = await Promise.all(paths.map(source));
    files.forEach((file) => expect(file.length).toBeGreaterThan(0));

    const main = await source('src/main.tsx');
    for (const definition of ['function NewTaskPage(', 'function QueuePage(', 'function HistoryPage(', 'function TaskDetailPage(', 'function ArtifactPreviewContent(']) {
      expect(main).not.toContain(definition);
    }
  });

  it('keeps task pages independent from app bootstrap, secrets, and barrels', async () => {
    const pages = await Promise.all([
      source('src/features/tasks/NewTaskPage.tsx'),
      source('src/features/tasks/QueuePage.tsx'),
      source('src/features/tasks/HistoryPage.tsx'),
      source('src/features/tasks/TaskDetailPage.tsx'),
      source('src/features/tasks/TaskArtifactPreview.tsx'),
    ]);
    for (const page of pages) {
      expect(page).not.toContain("from '../../main'");
      expect(page).not.toContain("from '../../app/app-state'");
      expect(page).not.toContain("from '../../app/browser-fallback'");
      expect(page).not.toContain("from '../../shared/config-secrets'");
      expect(page).not.toMatch(/from ['"]\.\/index['"]/u);
    }
  });

  it('retains the complete 51-field ordinary task input contract', async () => {
    const [types, builder, page] = await Promise.all([
      source('src/shared/types.ts'),
      source('src/features/tasks/task-create-input.ts'),
      source('src/features/tasks/NewTaskPage.tsx'),
    ]);
    const createInput = types.slice(types.indexOf('export type CreateTaskInput'), types.indexOf('export interface TaskEvent'));
    const fields = [...createInput.matchAll(/^\s*\| '([^']+)'/gmu)].map((match) => match[1]);
    expect(fields).toHaveLength(51);
    expect(builder).toContain('...input');
    const explicitlyOwned = fields.filter((field) => page.includes(field));
    expect(explicitlyOwned.length).toBeGreaterThanOrEqual(35);
    expect(new Set(explicitlyOwned).size).toBe(explicitlyOwned.length);
  });

  it('owns canonical pipeline and task formatting helpers outside the renderer entry', async () => {
    const [pipeline, formatters, main] = await Promise.all([
      source('src/features/tasks/task-pipeline.ts'),
      source('src/features/tasks/task-formatters.ts'),
      source('src/main.tsx'),
    ]);
    for (const symbol of ['pipelineStepStatus', 'statusLabelForStep', 'artifactPanelTitle', 'snapshotStepStatus', 'imageProgressLabel']) {
      expect(`${pipeline}\n${formatters}`).toContain(`export function ${symbol}`);
      expect(main).not.toContain(`function ${symbol}(`);
    }
    expect(formatters).toContain('export function formatDuration');
    expect(main).not.toContain('function formatDuration(');
  });
});

describe('local tool and lab feature ownership architecture', () => {
  const pagePaths = [
    'src/features/labs/BookSelectionPage.tsx',
    'src/features/labs/BenchmarkImportPage.tsx',
    'src/features/labs/PersonAssetsPage.tsx',
    'src/features/labs/ImageLabPage.tsx',
    'src/features/labs/VoiceLabPage.tsx',
  ];

  it('owns every local tool and lab page in a dedicated module', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    pages.forEach((page) => expect(page.length).toBeGreaterThan(0));

    const main = await source('src/main.tsx');
    for (const definition of ['function BookSelectionPage(', 'function BenchmarkImportPage(', 'function PersonAssetsPage(', 'function ImageLabPage(', 'function VoiceLabPage(']) {
      expect(main).not.toContain(definition);
    }
  });

  it('keeps local tool route props independent from app bootstrap, secrets, and barrels', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    for (const page of pages) {
      expect(page).not.toContain("from '../../main'");
      expect(page).not.toContain("from '../../app/app-state'");
      expect(page).not.toContain("from '../../app/browser-fallback'");
      expect(page).not.toContain("from '../../shared/config-secrets'");
      expect(page).not.toMatch(/from ['"]\.\/index['"]/u);
    }
  });

  it('owns image-lab calculations outside the renderer entry', async () => {
    const [helpers, main] = await Promise.all([
      source('src/features/labs/image-lab-helpers.ts'),
      source('src/main.tsx'),
    ]);
    for (const symbol of ['smartImageModeLabel', 'resolveImageLabSmartMode', 'parseReferenceImagePaths']) {
      expect(helpers).toContain(`export function ${symbol}`);
      expect(main).not.toContain(`function ${symbol}`);
    }
  });
});
