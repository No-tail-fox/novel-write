import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { voxProductionSettings } from '../src/shared/vox-production';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: any) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
}));
vi.mock('../src/ui', () => ({ Button: 'Button', CheckboxField: 'CheckboxField', Dialog: 'Dialog' }));
vi.mock('../src/features/editorial-collage/CreativeProductionFields', () => ({ CreativeProductionFields: 'CreativeProductionFields' }));
vi.mock('../src/features/editorial-collage/ProjectMusicFields', () => ({ ProjectMusicFields: 'ProjectMusicFields' }));
import { AsyncActionFeedback } from '../src/components/AsyncActionFeedback';
import { VoxProductionDialog } from '../src/features/editorial-collage/VoxProductionDialog';

type Props = Parameters<typeof VoxProductionDialog>[0];
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<{ children?: ReactNode }>(node) ? [node, ...nodes(node.props.children)] : [];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function render(props: Props) { hooks.cursor = 0; return VoxProductionDialog(props); }
function button(dialog: ReturnType<typeof render>, label: string) {
  const result = nodes(dialog.props.actions).find(node => node.type === 'Button' && text(node.props.children) === label);
  expect(result, label).toBeTruthy();
  return result;
}
function footerFeedback(dialog: ReturnType<typeof render>) {
  return nodes(dialog.props.actions).find(node => node.type === AsyncActionFeedback);
}
function fixture(): Props {
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'feedback-test', title: '城市热岛', ratio: '16:9' }), '道路与建筑吸收阳光。树荫可以降低地表温度。', '2026-11-03T00:00:00.000Z', 15000);
  document.productionSettings = { ...voxProductionSettings(), narration: false, generateImages: false, authoring: { mode: 'ai-code', styleId: 'watercolor' } };
  return { document, busy: false, feedback: null, onClose: vi.fn(), onStart: vi.fn(async () => {}), onSave: vi.fn(async () => {}), onApply: vi.fn(async () => {}), onOpenUrl: vi.fn(async () => {}), musicLibrary: [], api: { importBgmAudio: vi.fn(async () => null) } };
}
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

describe('production settings action feedback', () => {
  it.each(['LEMO_SDK_PROTOCOL: 官方 Agent SDK 需要 Anthropic Messages 协议。', '项目保存失败，请重试。', '网络连接失败，请稍后重试。'])('keeps backend failure visible beside the action buttons: %s', message => {
    const props = fixture();
    props.feedback = { tone: 'error', message };
    const dialog = render(props);
    const feedback = footerFeedback(dialog);
    expect(feedback?.props.feedback).toEqual(props.feedback);
    expect(AsyncActionFeedback(feedback.props)?.props.role).toBe('alert');
    expect(button(dialog, '按此风格创作全片').props.disabled).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each(['LEMO_SDK_PROTOCOL: 需要 Anthropic Messages。', '官方 Agent SDK 需要 Anthropic Messages 协议。（诊断号：fixture）', '请为创意动画选择 Anthropic Messages 文本模型。', 'LEMO_CAPABILITY_NOT_TESTED', '该模型尚未完成能力验证。'])('explains the project-model selection path for protocol and capability failures: %s', message => {
    const dialog = render({ ...fixture(), feedback: { tone: 'error', message } });
    expect(text(dialog.props.actions)).toContain('页面顶部“项目模型”');
    expect(text(dialog.props.actions)).toContain('先保存设置');
    expect(text(dialog.props.actions)).toContain('Chat Completions 或 Responses');
    expect(text(dialog.props.actions)).toContain('能力验证会调用所选服务商');
  });

  it('preserves unsaved settings after a failure and submits those settings on retry', () => {
    const props = fixture();
    let dialog = render(props);
    const fields = nodes(dialog.props.children).find(node => node.type === 'CreativeProductionFields');
    const settings = { ...fields.props.settings, authoring: { ...fields.props.settings.authoring, styleId: 'caption-news', brief: '大字开场，节奏克制。' } };
    fields.props.onChange(settings);
    dialog = render({ ...props, feedback: { tone: 'error', message: '启动失败，请重试。' } });
    button(dialog, '按此风格创作全片').props.onClick();
    expect(props.onStart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ authoring: expect.objectContaining(settings.authoring) }));
    expect(nodes(dialog.props.children).find(node => node.type === 'CreativeProductionFields').props.settings).toEqual(settings);
  });

  it('locks actions during startup, hides stale failure feedback, and prevents dismissal', () => {
    const props = { ...fixture(), busy: true, feedback: { tone: 'error' as const, message: '上次失败' } };
    const dialog = render(props);
    expect(footerFeedback(dialog)).toBeUndefined();
    expect(button(dialog, '准备中…').props['aria-busy']).toBe(true);
    expect(button(dialog, '准备中…').props.disabledFocusable).toBe(true);
    expect(button(dialog, '保存设置').props.disabledFocusable).toBe(true);
    expect(nodes(dialog.props.actions).filter(node => node.type === 'Button').every(node => node.props.disabled)).toBe(true);
    dialog.props.onOpenChange(false);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('shows invalid settings in the footer so a disabled start button has a visible reason', () => {
    const props = fixture();
    props.document.productionSettings!.authoring!.brief = '长'.repeat(2001);
    const dialog = render(props);
    expect(footerFeedback(dialog)?.props.feedback).toMatchObject({ tone: 'error', message: expect.stringContaining('请补齐') });
    expect(button(dialog, '按此风格创作全片').props.disabled).toBe(true);
    expect(button(dialog, '保存设置').props.disabled).toBe(true);
  });

  it('keeps template apply failures visible with the same feedback path', () => {
    const props = fixture();
    props.document.productionSettings!.authoring!.mode = 'template';
    props.feedback = { tone: 'error', message: '应用镜头风格失败。' };
    const dialog = render(props);
    expect(footerFeedback(dialog)?.props.feedback).toEqual(props.feedback);
    expect(button(dialog, '应用风格到现有镜头').props.disabled).toBe(false);
    expect(text(dialog.props.actions)).not.toContain('Anthropic Messages');
  });
});
