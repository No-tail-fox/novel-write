import { describe, expect, it } from 'vitest';
import { draftImageAnimationPreviewKind, draftImageMotionStyle } from '../src/features/templates/DraftCanvas';
import { draftTemplates, imageAnimations } from '../src/shared/templates';

describe('draft image animation hover previews', () => {
  it('maps Jianying animation names to stable visual preview families', () => {
    expect(draftImageAnimationPreviewKind('无动画')).toBe('none');
    expect(draftImageAnimationPreviewKind('左拉镜')).toBe('slide-left');
    expect(draftImageAnimationPreviewKind('下降向右')).toBe('drop-right');
    expect(draftImageAnimationPreviewKind('弹入旋转')).toBe('bounce');
    expect(draftImageAnimationPreviewKind('百叶窗 II')).toBe('split');
    expect(draftImageAnimationPreviewKind('翻转 IV')).toBe('flip');
    expect(draftImageAnimationPreviewKind('扭曲拉伸')).toBe('stretch');
    expect(draftImageAnimationPreviewKind('缩小弹动')).toBe('bounce');
    expect(draftImageAnimationPreviewKind('缩放')).toBe('zoom');
  });

  it('keeps compound direction and motion semantics in the preview family', () => {
    const expected: Record<string, string> = {
      向左缩小: 'slide-shrink-left',
      向右缩小: 'slide-shrink-right',
      向左下降: 'drop-left',
      向右下降: 'drop-right',
      旋转上升: 'spin-rise',
      旋转降落: 'spin-drop',
      旋转缩小: 'spin-shrink',
      旋出渐隐: 'spin-out',
      魔方: 'flip',
      坠落: 'drop',
      跳跳糖: 'bounce',
      转入转出: 'spin',
      波动滑出: 'wave',
      相框滑动: 'slide-left',
    };
    for (const [name, kind] of Object.entries(expected)) {
      expect(draftImageAnimationPreviewKind(name)).toBe(kind);
    }
    expect(imageAnimations.filter((name) => name !== '无动画' && draftImageAnimationPreviewKind(name) === 'none')).toEqual([]);
  });

  it('does not animate a camera when motion is disabled or strength is zero', () => {
    const stopped = structuredClone(draftTemplates[0]);
    stopped.image.motion = 'zoom_in';
    stopped.image.motionStrength = 0;
    expect(draftImageMotionStyle(stopped)).toEqual({});

    stopped.image.motionStrength = 1;
    expect(draftImageMotionStyle(stopped)).toMatchObject({ animationName: 'draft-motion-zoom_in' });
  });

  it('does not classify unrelated names from a single shared character', () => {
    expect(draftImageAnimationPreviewKind('转场缩放')).toBe('zoom');
    expect(draftImageAnimationPreviewKind('方向放大')).toBe('zoom');
  });
});
