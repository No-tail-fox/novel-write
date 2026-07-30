import type { StoryDreamApi } from './shared/storydream-api';
import type { HyperframesPlayer } from '@hyperframes/player';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  interface Window {
    storydream?: StoryDreamApi;
    storybound?: StoryDreamApi;
  }

}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': DetailedHTMLProps<HTMLAttributes<HyperframesPlayer>, HyperframesPlayer> & {
        src?: string;
        width?: number;
        height?: number;
        controls?: boolean;
        muted?: boolean;
      };
    }
  }
}
