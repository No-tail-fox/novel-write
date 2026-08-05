import { describe, expect, it } from 'vitest';
import { draftImageAnimationPreviewKind } from '../src/features/templates/DraftCanvas';

describe('draft image animation hover previews', () => {
  it('maps Jianying animation names to stable visual preview families', () => {
    expect(draftImageAnimationPreviewKind('无动画')).toBe('none');
    expect(draftImageAnimationPreviewKind('左拉镜')).toBe('slide-left');
    expect(draftImageAnimationPreviewKind('下降向右')).toBe('drop');
    expect(draftImageAnimationPreviewKind('弹入旋转')).toBe('bounce');
    expect(draftImageAnimationPreviewKind('百叶窗 II')).toBe('split');
    expect(draftImageAnimationPreviewKind('翻转 IV')).toBe('flip');
    expect(draftImageAnimationPreviewKind('扭曲拉伸')).toBe('stretch');
    expect(draftImageAnimationPreviewKind('缩小弹动')).toBe('bounce');
    expect(draftImageAnimationPreviewKind('缩放')).toBe('zoom');
  });

  it('does not classify unrelated names from a single shared character', () => {
    expect(draftImageAnimationPreviewKind('转场缩放')).toBe('zoom');
    expect(draftImageAnimationPreviewKind('方向放大')).toBe('zoom');
  });
});
