import type { VoxAnimationProps } from '../../../shared/vox-animation';

/** Content-stage coordinates. The host handles canvas scaling, heading and source. */
export interface ShotcraftSceneProps {
  p: VoxAnimationProps;
  images: string[];
  frame: number;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
}
