import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { ProductionSubtitleSceneLayout } from '../src/shared/production-subtitle-layout';
const { sidecar } = vi.hoisted(() => ({ sidecar: vi.fn() }));
vi.mock('../src/shared/storybound-sidecar', () => ({ runStoryboundMediaSidecar: sidecar }));
import { measureNativeGlyphCoverage } from '../electron/native-font-coverage';

const measured = (observed = true): ProductionSubtitleSceneLayout => ({
  status: 'ok', shotId: 'shot', width: 1920, height: 1080, fontsReady: true, viewportWidth: 1920, viewportHeight: 1080,
  safeArea: { x: 0, y: 0, width: 1920, height: 1080 }, titleBounds: null, titleOutsideSafeArea: false,
  cues: [{ text: '回家', startMs: 0, endMs: 1000, bounds: { x: 10, y: 10, width: 100, height: 50 }, textBounds: null, lineCount: 1, fontFamily: '"Missing Font", sans-serif', fontSize: 40, issues: [],
    renderedFontFamilies: observed ? ['"Missing Font", sans-serif'] : [] }],
});
function browser(glyphs = true) {
  let attached = false;
  const debuggerApi = { isAttached: () => attached, attach: vi.fn(() => { attached = true; }), detach: vi.fn(() => { attached = false; }),
    sendCommand: vi.fn(async (command: string) => {
      if (command === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (command === 'DOM.querySelectorAll') return { nodeIds: glyphs ? [2] : [] };
      if (command === 'CSS.getPlatformFontsForNode') return { fonts: [{ familyName: 'Microsoft YaHei', glyphCount: 2 }] };
      return {};
    }) };
  const window = { webContents: { debugger: debuggerApi, executeJavaScript: vi.fn(async () => undefined) } };
  return { window: window as unknown as BrowserWindow, debuggerApi };
}
beforeEach(() => { vi.clearAllMocks(); sidecar.mockResolvedValue({ glyph_results: [{ status: 'ok', supported_code_points: [22238, 23478], missing_code_points: [], font_families: ['Microsoft YaHei'] }] }); });
describe('native font fallback verification', () => {
  it('probes the actual Chromium fallback instead of treating a CSS stack as one installed family', async () => {
    const b = browser(); const result = await measureNativeGlyphCoverage(b.window, measured(), 'work');
    expect(sidecar.mock.calls[0][0].entries).toEqual([{ font_families: ['Microsoft YaHei'], code_points: [22238, 23478] }]);
    expect(result.status === 'ok' && result.cues[0].glyphCoverage).toMatchObject({ status: 'ok', verification: 'font-engine', renderedCodePointCount: 2 });
    expect(b.debuggerApi.detach).toHaveBeenCalledOnce();
    expect(b.window.webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('?.remove()'), true);
  });
  it('keeps an unobserved or unresolved font unverified', async () => {
    const b = browser(false); const result = await measureNativeGlyphCoverage(b.window, measured(false), 'work');
    expect(result.status === 'ok' && result.cues[0].glyphCoverage).toMatchObject({ status: 'unavailable', renderedCodePointCount: 0 });
  });
  it('cleans up and reports unavailable if the shaping engine cannot be queried', async () => {
    const b = browser(); b.debuggerApi.sendCommand.mockRejectedValueOnce(new Error('No debugger'));
    const result = await measureNativeGlyphCoverage(b.window, measured(), 'work');
    expect(result.status === 'ok' && result.cues[0].glyphCoverage?.status).toBe('unavailable');
    expect(sidecar).not.toHaveBeenCalled(); expect(b.debuggerApi.detach).toHaveBeenCalledOnce();
  });
});
