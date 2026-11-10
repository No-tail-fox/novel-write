import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreativeProductionFields } from '../src/features/editorial-collage/CreativeProductionFields';
import { createEditorialCollageDraft } from '../src/shared/editorial-collage';
import { voxProductionInputErrors, voxProductionSettingsSchema, type VoxProductionSettings } from '../src/shared/vox-production';

const settings = (styleId: string, patch: Partial<VoxProductionSettings> = {}) => voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'ai-code', styleId }, ...patch });
const document = () => ({ ...createEditorialCollageDraft({ id: 'material-ui', title: '港口', ratio: '16:9' }),
  assets: [{ id: 'clip', assetId: 'clip', kind: 'video' as const, localPath: 'C:/clips/street.mp4', prompt: 'street.mp4', provider: 'local-import', createdAt: '2026-11-10T00:00:00.000Z' }] });
const render = (value: VoxProductionSettings, onImportAsset?: (kind: 'image' | 'video') => Promise<string | undefined>) =>
  renderToStaticMarkup(createElement(CreativeProductionFields, { settings: value, onChange: () => undefined, onOpenUrl: async () => undefined, document: document(), onImportAsset }));

describe('Lemo material controls (导入图片 / 导入视频 / 允许 AI 生成插画)', () => {
  it('offers image and video import plus imported videos for the Lemo route', () => {
    const html = render(settings('brick-toy'), async () => undefined);
    expect(html).toContain('导入图片');
    expect(html).toContain('导入视频');
    expect(html).toContain('引用已导入的素材');
    const withRow = render(settings('brick-toy', { archives: [{ assetVersionId: 'clip', source: '自摄', license: '自有版权' }] }), async () => undefined);
    expect(withRow).toContain('视频 · street.mp4');
    expect(withRow).toContain('画面说明（选填）');
  });
  it('keeps illustrations off by default and locks them for documentary styles', () => {
    expect(render(settings('brick-toy'))).toContain('默认全部用代码绘制，不调用生图');
    expect(render(settings('brick-toy', { agentImages: { enabled: true, maxImages: 4 } }))).toContain('插画数量上限');
    const documentary = render(settings('kino-montage', { agentImages: { enabled: true, maxImages: 4 } }));
    expect(documentary).toContain('纪实/证据类风格只使用导入的真实素材');
    expect(documentary).not.toContain('插画数量上限');
    expect(voxProductionInputErrors({ ...document(), sourceText: '文案' }, settings('kino-montage', { agentImages: { enabled: true, maxImages: 4 } })).join()).toContain('纪实/证据类');
  });
  it('keeps the template route unchanged', () => {
    const html = render(voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'template', styleId: 'auto' } }));
    expect(html).toContain('自动生成图片');
    expect(html).not.toContain('允许 AI 生成插画');
  });
});
