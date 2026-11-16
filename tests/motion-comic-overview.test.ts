import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MotionComicProjectOverview } from '../src/features/motion-comic/MotionComicProjectOverview';
import { createMotionComicDraft, createMotionComicImportedProject, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import { motionComicOverviewRows } from '../src/features/motion-comic/motion-comic-overview';

const noop = () => {};
describe('motion comic project overview', () => {
  it('opens the selected structured episode by stable id and retains a separate continue action', () => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'overview', title: '雨夜来信', premise: '一封信', now: '2026-11-12T00:00:00Z' }));
    let opened = '';
    const tree = MotionComicProjectOverview({ document, busy: false, onOpenEpisode: id => { opened = id; }, onOpenScript: noop, onOpenAssets: noop, onContinue: noop, onBack: noop });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('继续制作');
    expect(markup).toContain('打开分集');
    expect(markup).toContain('当前分集');
    // Invoke the real row action without coupling the assertion to markup formatting.
    const columns = tree.props.children[1];
    const episodeSection = columns.props.children[0];
    const rows = episodeSection.props.children[1];
    rows[0].props.children[1].props.onClick();
    expect(opened).toBe(document.episodes[0].id);
  });

  it('keeps imported source rows and manually added episodes reachable', () => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'mixed', title: '混合', premise: '信', now: '2026-11-12T00:00:00Z' }));
    document.sourceDocument = { episodes: [{ id: 'source-1', number: 1, title: '原文集', sourceText: '源文' }] } as MotionComicPipelineData['sourceDocument'];
    const rows = motionComicOverviewRows(document);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceEpisodeId).toBe('source-1');
    expect(rows[1].episode?.id).toBe(document.episodes[0].id);
    document.episodes[0].planningEvidence = { sourceText: '源文' } as NonNullable<typeof document.episodes[0]['planningEvidence']>;
    const linked = motionComicOverviewRows(document);
    expect(linked).toHaveLength(1);
    expect(linked[0].episode?.id).toBe(document.episodes[0].id);
  });

  it('counts imported source episodes once without exposing the empty active placeholder', () => {
    const document = createMotionComicImportedProject(
      createMotionComicDraft({ id: 'imported', title: '雨夜来信', premise: '信', now: '2026-11-12T00:00:00Z' }),
      { kind: 'script', adaptationMode: 'faithful-script', originalText: '雨夜来信', episodes: [{ title: '第一集', sourceText: '雨夜来信' }, { title: '第二集', sourceText: '回信' }] },
    );
    const rows = motionComicOverviewRows(document);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.sourceEpisodeId && !row.episode)).toBe(true);
    const markup = renderToStaticMarkup(createElement(MotionComicProjectOverview, { document, busy: false, onOpenEpisode: noop, onOpenScript: noop, onOpenAssets: noop, onContinue: noop, onBack: noop }));
    expect((markup.match(/<article\b/g) ?? [])).toHaveLength(2);
  });

  it('does not duplicate a structured episode linked to its source by stable id', () => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'linked', title: '雨夜来信', premise: '信', now: '2026-11-12T00:00:00Z' }));
    document.sourceDocument = { episodes: [{ id: 'source-1', number: 1, title: '原文集', sourceText: '源文' }] } as MotionComicPipelineData['sourceDocument'];
    document.episodes[0].planningEvidence = { sourceEpisodeId: 'source-1', sourceText: '更新后的原文' } as NonNullable<typeof document.episodes[0]['planningEvidence']>;
    expect(motionComicOverviewRows(document)).toHaveLength(1);
  });

  it('disables navigation while the project is busy', () => {
    const document = createMotionComicDraft({ id: 'empty', title: '空项目', premise: '', now: '2026-11-12T00:00:00Z' });
    const markup = renderToStaticMarkup(createElement(MotionComicProjectOverview, { document, busy: true, onOpenEpisode: noop, onOpenScript: noop, onOpenAssets: noop, onContinue: noop, onBack: noop }));
    expect(markup).toContain('项目尚无分集');
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every(button => button.includes('disabled'))).toBe(true);
  });
});
