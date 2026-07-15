import type { StoryDreamApi } from './shared/storydream-api';

declare global {
  interface Window {
    storydream?: StoryDreamApi;
    storybound?: StoryDreamApi;
  }
}
