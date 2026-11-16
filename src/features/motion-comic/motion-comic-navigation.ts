import type { MotionComicWorkflowStage } from '../../shared/motion-comic';

/** Back follows the authoring workflow while keeping the current episode selected. */
export function motionComicBackTarget(stage: MotionComicWorkflowStage): { stage: MotionComicWorkflowStage | null; label: string } {
  switch (stage) {
    case 'scenes':
      return { stage: 'episodes', label: '返回本集剧本' };
    case 'storyboard':
      return { stage: 'episodes', label: '返回剧本' };
    case 'video':
      return { stage: 'storyboard', label: '返回分镜' };
    case 'audio':
      return { stage: 'video', label: '返回视频生成' };
    case 'export':
      return { stage: 'audio', label: '返回配音合成' };
    default:
      return { stage: null, label: '返回项目总览' };
  }
}
