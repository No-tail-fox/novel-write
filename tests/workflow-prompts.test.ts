import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPromptTemplates } from '../src/shared/prompt-template-defaults';
import { workflowPromptCatalog } from '../src/shared/workflow-prompt-catalog';
import { preparePromptTemplateSave, selectWorkflowPrompt, setWorkflowPromptTemplateProvider, validateWorkflowTemplate, workflowPrompt, workflowSlotChannels } from '../src/shared/workflow-prompt-runtime';
import type { PromptChannel, PromptTemplate } from '../src/shared/types';
import { buildDirectorCopyAssistRequest } from '../src/shared/director-copy-assist';
import { buildStoryboundAiCreationSystemPrompt, buildStoryboundReviewSystemPrompt, composeCopyFromSources } from '../src/shared/research';
import { buildHtmlVideoPlanningSystemPrompt } from '../src/shared/task-runtime-providers';
import { lemoNativeMessages } from '../src/shared/creative-animation/native-film';
import { CREATIVE_STYLES, creativeStyle } from '../src/shared/creative-animation/styles';
import { COPYWRITING_TRACKS } from '../src/shared/copywriting-tracks';
import { EDITORIAL_WRITING_STYLES } from '../src/shared/editorial-writing-styles';
import { buildEditorialLayerPrompt, buildEditorialScenePrompt } from '../src/shared/editorial-image-prompts';
import { creativeLayerPrompt } from '../src/shared/creative-animation/image-prompts';
import { selectStepPromptTemplate } from '../src/shared/prompt-templates';
import { FileDatabase } from '../src/shared/storage';

const workflowDefaults = defaultPromptTemplates.filter(t => t.type === 'workflow');
function custom(slot: string, content: string, channel: PromptChannel = 'shared', extra: Partial<PromptTemplate> = {}): PromptTemplate {
  return { ...workflowDefaults.find(t => t.slot === slot)!, id: 'custom-' + slot + '-' + channel, content, isBuiltin: false, origin: 'custom', channel, enabled: true, updatedAt: '2026-10-28T00:00:00.000Z', ...extra };
}
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe('workflow prompt application', () => {
  it('exposes all tracks, writing styles and every visual adapter with exact source text', () => {
    expect(workflowDefaults).toHaveLength(workflowPromptCatalog.length);
    expect(new Set(workflowDefaults.map(t => t.id)).size).toBe(workflowDefaults.length);
    for (const track of COPYWRITING_TRACKS) expect(workflowDefaults.find(t => t.slot === `writing-track:${track.id}`)?.content).toBe(track.guidance);
    for (const style of EDITORIAL_WRITING_STYLES) expect(workflowDefaults.find(t => t.slot === `writing-style:${style.id}`)).toMatchObject({ content: style.guidance, channel: 'shared' });
    for (const style of CREATIVE_STYLES) {
      expect(workflowDefaults.find(t => t.slot === `creative-image:${style.slug}`)?.content).toBe(style.adapter.imageDirection);
      expect(workflowDefaults.find(t => t.slot === `creative-motion:${style.slug}`)?.content).toBe(style.adapter.motionDirection);
    }
  });

  it('selects enabled channel overrides, shared fallback and the most recent applied version', () => {
    const shared = custom('research-copy', 'public');
    const html = custom('research-copy', 'html', 'html-video');
    const disabled = custom('research-copy', 'disabled', 'html-video', { id: 'disabled', enabled: false, updatedAt: '2026-10-29' });
    const editedBuiltin = { ...workflowDefaults.find(t => t.slot === 'research-copy')!, content: 'saved default', builtinModified: true, updatedAt: '2026-10-30' };
    const templates = [...workflowDefaults, shared, html, disabled, editedBuiltin];
    expect(workflowPrompt('research-copy', 'source', {}, 'html-video', templates)).toBe('html');
    expect(workflowPrompt('research-copy', 'source', {}, 'motion-comic', templates)).toBe('saved default');
    expect(selectWorkflowPrompt([shared, { ...shared, id: 'new', updatedAt: '2026-11-01' }], 'research-copy', 'story')?.id).toBe('new');
  });

  it('only offers channels that actually call the selected prompt', () => {
    expect(workflowSlotChannels('writing-style:story')).toEqual(['shared', 'html-video', 'editorial-collage']);
    expect(workflowSlotChannels('director-copy-2')).toEqual(['shared', 'motion-comic']);
    expect(workflowSlotChannels('research-copy')).not.toContain('music-mv');
    expect(() => validateWorkflowTemplate(custom('research-copy', 'unused', 'music-mv'))).toThrow('匹配的创作频道');
    expect(() => validateWorkflowTemplate(custom('writing-style:story', 'unused', 'motion-comic'))).toThrow('匹配的创作频道');
    expect(() => validateWorkflowTemplate(custom('writing-style:story', 'used', 'html-video'))).not.toThrow();
  });

  it('validates variables and protects builtin identity while allowing edits', () => {
    const original = workflowDefaults.find(t => t.slot === 'html-planning')!;
    const saved = preparePromptTemplateSave({ ...original, isBuiltin: false, type: 'task', channel: 'music-mv', slot: 'research-copy', content: 'saved {{orientation}}' }, original);
    expect(saved).toMatchObject({ isBuiltin: true, type: 'workflow', channel: 'html-video', slot: 'html-planning', builtinModified: true });
    expect(workflowPrompt('html-planning', '', { orientation: '横屏' }, 'html-video', [saved])).toBe('saved 横屏');
    expect(() => validateWorkflowTemplate({ ...saved, content: '{{unknown}}' })).toThrow('不支持变量');
    expect(() => workflowPrompt('html-planning', '', {}, 'html-video', [saved])).toThrow('未知变量');
    expect(() => validateWorkflowTemplate({ ...saved, channel: 'music-mv' })).toThrow('匹配');
  });

  it('rebuilds director prompts on the host and applies HTML channel track and style overrides', async () => {
    const request = buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'create', title: '城市', copy: '', writingStyleId: 'documentary', track: 'general' });
    const templates = [custom('writing-style:documentary', 'HOST_STYLE', 'editorial-collage'), custom('writing-style:documentary', 'HTML_STYLE', 'html-video'), custom('writing-track:general', 'HTML_TRACK', 'html-video')];
    restore = setWorkflowPromptTemplateProvider(() => templates);
    const seen: string[] = [];
    const llm = { protocol: 'openai' as const, run: async (input: { messages: Array<{ content: string }> }) => { seen.push(input.messages.map(m => m.content).join('\n')); return { text: '有效文案。', raw: '', requestId: null }; } };
    await composeCopyFromSources(llm, request);
    await composeCopyFromSources(llm, { channel: 'html-video', keyword: '城市', selectedSources: [], useBuiltinKnowledge: true, track: 'general', writingStyleId: 'documentary', extraRequirements: '' });
    expect(seen[0]).toContain('HOST_STYLE'); expect(seen[0]).not.toContain('HTML_STYLE');
    expect(seen[1]).toContain('HTML_STYLE'); expect(seen[1]).toContain('HTML_TRACK'); expect(seen[1]).not.toContain('HOST_STYLE');
  });

  it('restores the provider and resolves visual material and motion rules at request time', () => {
    const before = creativeStyle('halftone-dossier')!;
    restore = setWorkflowPromptTemplateProvider(() => [custom('creative-image:halftone-dossier', 'image override', 'editorial-collage'), custom('creative-motion:halftone-dossier', 'motion override', 'editorial-collage')]);
    expect(creativeStyle('halftone-dossier')!.adapter.direction).toBe('Material and composition: image override\nMotion grammar: motion override');
    restore(); restore = undefined;
    expect(creativeStyle('halftone-dossier')).toEqual(before);
  });

  it('renders the extracted defaults exactly like original source across dynamic branches', () => {
    function snapshot() {
      const result: unknown[] = [];
      for (const track of COPYWRITING_TRACKS) for (const hasReferenceMaterials of [false, true]) for (const useAiKnowledge of [false, true]) {
        result.push(buildStoryboundAiCreationSystemPrompt({ trackName: track.id, trackTag: track.tag, hasReferenceMaterials, useAiKnowledge }));
        result.push(buildStoryboundReviewSystemPrompt({ track: track.id, aiSources: useAiKnowledge ? ['builtin-knowledge'] : [], targetLength: 300 }, hasReferenceMaterials));
      }
      for (const mode of ['vox', 'motion-comic'] as const) for (const intent of ['create', 'revise'] as const) for (const durationMs of ['auto', 15000, 30000, 60000] as const) for (const style of EDITORIAL_WRITING_STYLES) {
        result.push(buildDirectorCopyAssistRequest({ mode, intent, title: '城市', copy: '原始内容。', requirements: '用户要求', durationMs, writingStyleId: style.id }));
      }
      for (const foreground of [false, true]) for (const ratio of ['16:9', '9:16'] as const) result.push(buildHtmlVideoPlanningSystemPrompt({ foreground, ratio }));
      for (const stage of ['plan', 'code'] as const) for (const projectVersion of [undefined, 2] as const) result.push(lemoNativeMessages('reference', { stage, prompt: 'approved', source: 'source', projectVersion }));
      for (const kind of ['background', 'subject', 'shape'] as const) {
        result.push(buildEditorialLayerPrompt(kind, '语义上下文'));
        result.push(creativeLayerPrompt(kind, '语义上下文'));
      }
      result.push(buildEditorialScenePrompt({ narration: '旁白', ratio: '16:9' }));
      for (const style of CREATIVE_STYLES) result.push(creativeStyle(style.slug));
      return result;
    }
    const before = snapshot();
    restore = setWorkflowPromptTemplateProvider(() => workflowDefaults.map(t => ({ ...t, builtinModified: true })));
    expect(snapshot()).toEqual(before);
  });

  it('applies edited standalone stages over unchanged task defaults, respecting track and enabled state', () => {
    const task = defaultPromptTemplates.find(t => t.type === 'task' && t.baseTrack === 'general')!;
    const stage = { ...defaultPromptTemplates.find(t => t.id === 'builtin-rewrite')!, content: 'saved rewrite', builtinModified: true };
    expect(selectStepPromptTemplate([...defaultPromptTemplates, stage], 'rewrite', task)?.content).toBe('saved rewrite');
    const unrelated = { ...stage, id: 'other-track', baseTrack: 'picture-book', updatedAt: '2026-11-01' };
    const disabled = { ...stage, id: 'disabled-stage', enabled: false, updatedAt: '2026-11-02' };
    expect(selectStepPromptTemplate([stage, unrelated, disabled], 'rewrite', task)?.id).toBe(stage.id);
    expect(selectStepPromptTemplate([stage], 'rewrite', { ...task, isBuiltin: false })?.content).toBe(task.stepPrompts?.rewrite);
  });

  it('persists edited defaults and custom templates through restart; reset keeps customs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-workflow-prompts-'));
    const file = join(dir, 'app.db');
    let db: FileDatabase | undefined;
    try {
      db = await FileDatabase.open(file);
      const original = workflowDefaults.find(t => t.slot === 'writing-style:documentary')!;
      await db.upsertPromptTemplate({ ...original, isBuiltin: false, content: 'edited default' });
      await db.upsertPromptTemplate(custom(original.slot!, 'custom HTML', 'html-video'));
      expect(workflowPrompt(original.slot!, '', {}, 'html-video', db.getWorkflowPromptTemplates())).toBe('custom HTML');
      await db.close(); db = await FileDatabase.open(file);
      expect((await db.getPromptTemplateDetail(original.id))?.content).toBe('edited default');
      expect(workflowPrompt(original.slot!, '', {}, 'editorial-collage', db.getWorkflowPromptTemplates())).toBe('edited default');
      await db.resetPromptTemplates();
      expect((await db.getPromptTemplateDetail(original.id))?.content).toBe(original.content);
      expect(workflowPrompt(original.slot!, '', {}, 'html-video', db.getWorkflowPromptTemplates())).toBe('custom HTML');
    } finally { await db?.close(); await rm(dir, { recursive: true, force: true }); }
  });
});

