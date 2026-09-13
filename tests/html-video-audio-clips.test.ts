import { describe, expect, it } from 'vitest';
import { createHtmlVideoComposePayload, type HtmlVideoComposition } from '../src/shared/html-video';

describe('HTML renderer audio clip contract', () => {
  it('forwards the same clip list captured for preview into compose_render', () => {
    const input: HtmlVideoComposition = {
      workDir: 'C:/work', outputPath: 'C:/out.mp4', title: 'test', fps: 24, canvas_w: 1920, canvas_h: 1080, totalDurationS: 1,
      scenes: [{ sceneId: 1, title: 'shot', caption: '', description: '', imagePath: 'C:/image.png', audioPath: '', html: '<html></html>', durationMs: 1000, duration: 1,
        audioClips: [{ id: 'dialogue', path: 'C:/voice.wav', trackType: 'dialogue', startMs: 100, durationMs: 500, gainDb: -3 }] }],
    };
    const payload = createHtmlVideoComposePayload(input, [{ sceneId: 1, framesDir: 'C:/frames', audioPath: '', fps: 24, audioClips: input.scenes[0].audioClips }]);
    expect(payload.scenes[0].audio_clips).toEqual(input.scenes[0].audioClips);
    expect(payload.scenes[0].audio_path).toBe('');
  });
});
