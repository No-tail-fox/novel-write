import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { RouteErrorBoundary } from '../src/app/RouteErrorBoundary';
import { styleLabel } from '../src/features/tasks/task-formatters';
import { styleOptions } from '../src/shared/editorial-options';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8').catch(() => '');
}

const applicationCompositionPaths = [
  'src/main.tsx',
  'src/app/App.tsx',
  'src/app/AppShell.tsx',
  'src/app/AppRoutes.tsx',
];

async function applicationCompositionSource(): Promise<string> {
  return (await Promise.all(applicationCompositionPaths.map(source))).join('\n');
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

    const composition = await applicationCompositionSource();
    for (const definition of ['function Field(', 'function Segmented(', 'function ToggleField(', 'function RangeField(', 'function OptionCloud(', 'function Accordion(']) {
      expect(composition).not.toContain(definition);
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

    const composition = await applicationCompositionSource();
    for (const definition of ['function InlineActionFeedback(', 'function ErrorSummaryButton(', 'function ErrorDetailDialog(', 'function StatusPill(', 'function EmptyState(', 'function EventTimeline(']) {
      expect(composition).not.toContain(definition);
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
    const [appState, fallback, composition] = await Promise.all([
      source('src/app/app-state.ts'),
      source('src/app/browser-fallback.ts'),
      applicationCompositionSource(),
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
    expect(composition).not.toContain('function makeFallbackApi(');
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
    const [options, composition] = await Promise.all([
      source('src/shared/editorial-options.ts'),
      applicationCompositionSource(),
    ]);
    for (const symbol of ['contentTracks', 'styleOptions', 'ratioOptions', 'smartImageModeOptions', 'pauseOptions', 'rewriteOptions', 'promptTemplateVariableDefinitions']) {
      expect(options).toContain(`export const ${symbol}`);
      expect(composition).not.toContain(`const ${symbol}`);
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

    const composition = await applicationCompositionSource();
    for (const definition of ['function NewTaskPage(', 'function QueuePage(', 'function HistoryPage(', 'function TaskDetailPage(', 'function ArtifactPreviewContent(']) {
      expect(composition).not.toContain(definition);
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

  it('retains the complete ordinary task input contract, including the managed cover id', async () => {
    const [types, builder, page] = await Promise.all([
      source('src/shared/types.ts'),
      source('src/features/tasks/task-create-input.ts'),
      source('src/features/tasks/NewTaskPage.tsx'),
    ]);
    const createInput = types.slice(types.indexOf('export type CreateTaskInput'), types.indexOf('export interface TaskEvent'));
    const fields = [...createInput.matchAll(/^\s*\| '([^']+)'/gmu)].map((match) => match[1]);
    expect(fields).toHaveLength(56);
    expect(builder).toContain('...input');
    const explicitlyOwned = fields.filter((field) => page.includes(field));
    expect(explicitlyOwned.length).toBeGreaterThanOrEqual(35);
    expect(new Set(explicitlyOwned).size).toBe(explicitlyOwned.length);
  });

  it('owns canonical pipeline and task formatting helpers outside the renderer entry', async () => {
    const [pipeline, formatters, composition] = await Promise.all([
      source('src/features/tasks/task-pipeline.ts'),
      source('src/features/tasks/task-formatters.ts'),
      applicationCompositionSource(),
    ]);
    for (const symbol of ['pipelineStepStatus', 'statusLabelForStep', 'artifactPanelTitle', 'snapshotStepStatus', 'imageProgressLabel']) {
      expect(`${pipeline}\n${formatters}`).toContain(`export function ${symbol}`);
      expect(composition).not.toContain(`function ${symbol}(`);
    }
    expect(formatters).toContain('export function formatDuration');
    expect(composition).not.toContain('function formatDuration(');
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

    const composition = await applicationCompositionSource();
    for (const definition of ['function BookSelectionPage(', 'function BenchmarkImportPage(', 'function PersonAssetsPage(', 'function ImageLabPage(', 'function VoiceLabPage(']) {
      expect(composition).not.toContain(definition);
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
    const [helpers, composition] = await Promise.all([
      source('src/features/labs/image-lab-helpers.ts'),
      applicationCompositionSource(),
    ]);
    for (const symbol of ['smartImageModeLabel', 'resolveImageLabSmartMode', 'parseReferenceImagePaths']) {
      expect(helpers).toContain(`export function ${symbol}`);
      expect(composition).not.toContain(`function ${symbol}`);
    }
  });
});

describe('media workflow feature ownership architecture', () => {
  const pagePaths = [
    'src/features/music-mv/MusicMvPage.tsx',
    'src/features/html-video/HtmlVideoPage.tsx',
    'src/features/html-video/HtmlVideoTabPanel.tsx',
    'src/features/viral/ViralAnalyzerPage.tsx',
    'src/features/viral/ViralReport.tsx',
  ];

  it('owns each media workflow surface in its feature module', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    pages.forEach((page) => expect(page.length).toBeGreaterThan(0));

    const composition = await applicationCompositionSource();
    for (const definition of ['function MusicMvPage(', 'function HtmlVideoPage(', 'function HtmlVideoTabPanel(', 'function ViralAnalyzerPage(', 'function ViralReport(']) {
      expect(composition).not.toContain(definition);
    }
  });

  it('keeps media workflows independent from bootstrap, secrets, and barrels', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    for (const page of pages) {
      expect(page).not.toContain("from '../../main'");
      expect(page).not.toContain("from '../../app/app-state'");
      expect(page).not.toContain("from '../../app/browser-fallback'");
      expect(page).not.toContain("from '../../shared/config-secrets'");
      expect(page).not.toMatch(/from ['"]\.\/index['"]/u);
    }
  });

  it('keeps HTML tabs and viral reports owned outside their route components', async () => {
    const [htmlPage, htmlTabs, viralPage, viralReport] = await Promise.all([
      source('src/features/html-video/HtmlVideoPage.tsx'),
      source('src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('src/features/viral/ViralAnalyzerPage.tsx'),
      source('src/features/viral/ViralReport.tsx'),
    ]);
    expect(htmlPage).not.toContain('function HtmlVideoTabPanel(');
    expect(htmlTabs).toContain('export function HtmlVideoTabPanel(');
    expect(viralPage).not.toContain('function ViralReport(');
    expect(viralReport).toContain('export function ViralReport(');
  });
});

describe('template feature ownership architecture', () => {
  const pagePaths = [
    'src/features/templates/PromptTemplatesPage.tsx',
    'src/features/templates/PromptTemplateEditor.tsx',
    'src/features/templates/DraftTemplatesPage.tsx',
    'src/features/templates/DraftCanvas.tsx',
  ];

  it('owns template pages and editors in dedicated feature modules', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    pages.forEach((page) => expect(page.length).toBeGreaterThan(0));

    const composition = await applicationCompositionSource();
    for (const definition of ['function PromptTemplatesPage(', 'function PromptTemplateEditor(', 'function DraftTemplatesPage(', 'function DraftTemplatePreview(', 'function EditableDraftCanvas(']) {
      expect(composition).not.toContain(definition);
    }
  });

  it('keeps template features independent from bootstrap, secrets, and barrels', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    for (const page of pages) {
      expect(page).not.toContain("from '../../main'");
      expect(page).not.toContain("from '../../app/app-state'");
      expect(page).not.toContain("from '../../app/browser-fallback'");
      expect(page).not.toContain("from '../../shared/config-secrets'");
      expect(page).not.toMatch(/from ['"]\.\/index['"]/u);
    }
  });

  it('separates prompt editors and draft canvas ownership from their route pages', async () => {
    const [promptPage, promptEditor, draftPage, draftCanvas] = await Promise.all(pagePaths.map(source));
    expect(promptPage).not.toContain('function PromptTemplateEditor(');
    expect(promptEditor).toContain('export function PromptTemplateEditor(');
    expect(draftPage).not.toContain('function EditableDraftCanvas(');
    expect(draftPage).not.toContain('function DraftTemplatePreview(');
    expect(draftCanvas).toContain('export function EditableDraftCanvas(');
    expect(draftCanvas).toContain('export function DraftTemplatePreview(');
    expect(draftCanvas).toContain('export function resizeDraftLayerWidth(');
  });
});

describe('system page feature ownership architecture', () => {
  const pagePaths = [
    'src/features/settings/SettingsPage.tsx',
    'src/features/settings/ProviderProfileManagers.tsx',
    'src/features/settings/settings-controls.tsx',
    'src/features/account/AccountPage.tsx',
    'src/features/account/ActivationPage.tsx',
  ];

  it('owns settings, provider profiles, account, and activation in dedicated feature modules', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    pages.forEach((page) => expect(page.length).toBeGreaterThan(0));

    const composition = await applicationCompositionSource();
    for (const definition of [
      'function SettingsPage(',
      'function LlmProfileManager(',
      'function ImageProfileManager(',
      'function TtsProfileManager(',
      'function AccountPage(',
      'function ActivationPage(',
      'function SettingsCard(',
      'function ModelPicker(',
    ]) {
      expect(composition).not.toContain(definition);
    }
  });

  it('keeps system pages independent from bootstrap and browser fallback ownership', async () => {
    const pages = await Promise.all(pagePaths.map(source));
    for (const page of pages) {
      expect(page).not.toContain("from '../../main'");
      expect(page).not.toContain("from '../../app/app-state'");
      expect(page).not.toContain("from '../../app/browser-fallback'");
      expect(page).not.toMatch(/from ['"]\.\/index['"]/u);
    }
  });

  it('keeps provider managers and shared settings controls outside the settings route', async () => {
    const [settingsPage, managers, controls] = await Promise.all(pagePaths.slice(0, 3).map(source));
    for (const definition of ['function LlmProfileManager(', 'function ImageProfileManager(', 'function TtsProfileManager(']) {
      expect(settingsPage).not.toContain(definition);
      expect(managers).toContain(`export ${definition}`);
    }
    for (const definition of ['function SettingsCard(', 'function ModelPicker(']) {
      expect(settingsPage).not.toContain(definition);
      expect(controls).toContain(`export ${definition}`);
    }
  });
});

describe('renderer application composition architecture', () => {
  const appPaths = [
    'src/app/App.tsx',
    'src/app/AppShell.tsx',
    'src/app/AppRoutes.tsx',
    'src/app/RouteErrorBoundary.tsx',
    'src/app/RouteLoadingState.tsx',
  ];

  it('keeps the renderer entry limited to style setup and App mounting', async () => {
    const [main, applicationBoundary, ...owners] = await Promise.all([
      source('src/main.tsx'),
      source('src/app/ApplicationErrorBoundary.tsx'),
      ...appPaths.map(source),
    ]);
    expect(applicationBoundary.length).toBeGreaterThan(0);
    owners.forEach((owner) => expect(owner.length).toBeGreaterThan(0));
    expect(main).toContain("import { App } from './app/App'");
    expect(main).toContain("import './styles.css'");
    expect(main).toContain('createRoot(rootElement)');
    expect(main).toContain('<ApplicationErrorBoundary>');
    expect(main).toContain('<App />');
    expect(applicationBoundary).toContain('getDerivedStateFromError');
    expect(applicationBoundary).toContain('revealThemedApplication()');
    expect(applicationBoundary).toContain('重新加载应用');
    for (const implementation of ['function App(', 'function NavButton(', 'api.getBootstrap(', 'api.onAppDelta(', 'sidebarNavGroups.map(']) {
      expect(main).not.toContain(implementation);
    }
    expect(main.length).toBeLessThan(1_200);
  });

  it('separates runtime state, shell chrome, and static route composition', async () => {
    const [app, shell, routes] = await Promise.all(appPaths.slice(0, 3).map(source));
    for (const symbol of ['api.getBootstrap(', 'api.onAppDelta(', 'api.reconcileDeltas(', 'refreshTaskDetail', 'refreshViralEvents', 'applyStoredTheme']) {
      expect(app).toContain(symbol);
    }
    for (const symbol of ['window-controls', 'sidebarNavGroups.map(', 'group.items.map(', 'recent-task-strip', 'global-action-banner']) {
      expect(shell).toContain(symbol);
    }
    for (const symbol of ['NewTaskPage', 'TaskDetailPage', 'HtmlVideoPage', 'PromptTemplatesPage', 'SettingsPage', 'ActivationPage']) {
      expect(routes).toContain(symbol);
    }
    expect(shell).not.toContain("from '../features/");
    expect(routes).not.toContain('api.onAppDelta(');
  });

  it('provides bounded route loading and recoverable route errors', async () => {
    const [boundary, loading] = await Promise.all(appPaths.slice(3).map(source));
    expect(boundary).toContain('getDerivedStateFromError');
    expect(boundary).toContain('componentDidCatch');
    expect(boundary).toContain('重新加载页面');
    expect(boundary).toContain('返回新建任务');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('route-loading-state');
    expect(loading).toContain('正在加载');
  });

  it('lazy-loads all seventeen route pages behind one stable content fallback', async () => {
    const [routes, registry] = await Promise.all([
      source('src/app/AppRoutes.tsx'),
      source('src/app/route-registry.ts'),
    ]);
    const dynamicRoutes = [...registry.matchAll(/import\('([^']+)'\)\.then\(\(module\) => \(\{ default: module\.([A-Za-z0-9]+) \}\)\)/gu)];

    expect(routes).toContain("import { Suspense } from 'react'");
    expect(routes).toContain("import { RouteLoadingState } from './RouteLoadingState'");
    expect(routes).toContain("from './route-registry'");
    expect(registry).toContain("import { lazy } from 'react'");
    expect(routes).toContain('<Suspense fallback={<RouteLoadingState />}>');
    expect(routes).toContain('</Suspense>');
    expect(dynamicRoutes).toHaveLength(17);
    expect(new Set(dynamicRoutes.map((match) => match[1])).size).toBe(17);
    expect(new Set(dynamicRoutes.map((match) => match[2])).size).toBe(17);
    expect(`${routes}\n${registry}`).not.toMatch(/^import \{ [A-Za-z0-9]+Page \} from '\.\.\/features\//gmu);
  });

  it('resets only errors owned by the previous route key before rendering the next route', () => {
    const boundaryType = RouteErrorBoundary as unknown as {
      getDerivedStateFromError(error: Error): { error: Error };
      getDerivedStateFromProps(
        props: { resetKey: 'new-task' | 'settings' },
        state: { error: Error | null; resetKey: 'new-task' | 'settings' },
      ): { error: null; resetKey: 'new-task' | 'settings' } | null;
    };
    expect(typeof boundaryType.getDerivedStateFromProps).toBe('function');
    if (typeof boundaryType.getDerivedStateFromProps !== 'function') return;

    const previousError = new Error('old route failed');
    expect(boundaryType.getDerivedStateFromProps(
      { resetKey: 'settings' },
      { error: previousError, resetKey: 'new-task' },
    )).toEqual({ error: null, resetKey: 'settings' });

    const capturedOnNextRoute = {
      error: boundaryType.getDerivedStateFromError(new Error('next route failed')).error,
      resetKey: 'settings' as const,
    };
    expect(boundaryType.getDerivedStateFromProps({ resetKey: 'settings' }, capturedOnNextRoute)).toBeNull();
    expect(capturedOnNextRoute.error.message).toBe('next route failed');
  });

  it('clears a failed new-task route before navigating back to that same route key', () => {
    const navigated: string[] = [];
    const boundary = new RouteErrorBoundary({
      children: null,
      resetKey: 'new-task',
      onNavigate: (view) => navigated.push(view),
    });
    boundary.state = { ...boundary.state, error: new Error('new task failed') };
    boundary.setState = ((update: { error: Error | null }, callback?: () => void) => {
      boundary.state = { ...boundary.state, ...update };
      callback?.();
    }) as typeof boundary.setState;
    const returnToNewTask = (boundary as unknown as { returnToNewTask?: () => void }).returnToNewTask;

    expect(typeof returnToNewTask).toBe('function');
    returnToNewTask?.();
    expect(boundary.state.error).toBeNull();
    expect(navigated).toEqual(['new-task']);
  });
});
