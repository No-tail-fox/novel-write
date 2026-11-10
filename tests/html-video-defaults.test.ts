import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// H-4: one fps default for the HTML route. The preview handshake used to fall back to 30 fps while
// rendering defaults to 24, so preview frame counts disagreed with the rendered film.
describe('HTML route timing defaults', () => {
  const runtime = readFileSync('electron/html-video-runtime.ts', 'utf8');

  it('uses the runtime default fps for compositions that do not declare one', () => {
    expect(runtime).toContain('const defaultFps = 24;');
    expect(runtime).toContain('declaredFps > 0 ? declaredFps : ${defaultFps};');
    expect(runtime).not.toMatch(/declaredFps > 0 \? declaredFps : 30/u);
  });

  it('keeps 1280 px as the documented default render long edge (1080/1920 selectable)', () => {
    expect(runtime).toContain('const defaultMaxLongEdge = 1280;');
    expect(readFileSync('src/features/html-video/HtmlVideoPage.tsx', 'utf8')).toContain('默认 · 1280 px');
  });
});
