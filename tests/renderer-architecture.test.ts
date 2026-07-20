import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
