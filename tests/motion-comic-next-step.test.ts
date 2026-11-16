import { describe, expect, it } from 'vitest';
import { nextMotionComicWorkflowStage, type MotionComicStageState } from '../src/features/motion-comic/MotionComicProductionWorkspace';
import { MOTION_COMIC_WORKFLOW_STAGES, type MotionComicWorkflowStage } from '../src/shared/motion-comic';

describe('motion comic next-step guidance', () => {
  it('selects the next incomplete ready stage by workflow domain and returns none when complete', () => {
    const states = Object.fromEntries(MOTION_COMIC_WORKFLOW_STAGES.map((stage) => [stage, { ready: false, complete: true, detail: stage }])) as Record<MotionComicWorkflowStage, MotionComicStageState>;
    states.assets = { ready: true, complete: false, detail: '2 项参考图待生成' };
    states.scenes = { ready: true, complete: true, detail: '分幕已完成' };
    states.storyboard = { ready: true, complete: false, detail: '0/4 镜头图已就绪' };
    states.video = { ready: true, complete: false, detail: '0/4 远程视频已就绪' };
    expect(nextMotionComicWorkflowStage('assets', states)).toBe('video');
    states.assets.complete = true;
    expect(nextMotionComicWorkflowStage('assets', states)).toBe('video');
    // Optional storyboard images never return as unfinished work after video completion.
    states.video.complete = true;
    expect(nextMotionComicWorkflowStage('export', states)).toBeUndefined();
  });
});
