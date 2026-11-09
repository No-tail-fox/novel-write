import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { measureNativeCanvasText } from '../src/shared/creative-animation/native-canvas-text';
import { creativeLayoutInspectionScript } from '../src/shared/creative-animation/layout-review';
import { creativeUnsupportedClaims } from '../src/shared/creative-animation/review';

const context = (changes: Record<string, unknown> = {}) => ({
  canvas: { isConnected: true, width: 1920, height: 1080 }, globalAlpha: 1, font: '32px "Test Font"',
  measureText: () => ({ width: 200, actualBoundingBoxLeft: 100, actualBoundingBoxRight: 100, actualBoundingBoxAscent: 25, actualBoundingBoxDescent: 5 }),
  getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), ...changes,
}) as unknown as CanvasRenderingContext2D;

describe('native stage text review', () => {
  it('measures aligned glyphs with maxWidth and the actual canvas transform', () => {
    const row = measureNativeCanvasText(context({ getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }) }), '结论', 500, 200, 100);
    expect(row).toMatchObject({ x0: 910, x1: 1110, y0: 370, y1: 430, fontSize: 64, fontFamily: '"Test Font"' });
  });
  it('ignores cached, invisible, and fully offstage draws but retains clipped text', () => {
    expect(measureNativeCanvasText(context({ canvas: { isConnected: false } }), '缓存', 500, 200)).toBeUndefined();
    expect(measureNativeCanvasText(context({ globalAlpha: 0 }), '隐藏', 500, 200)).toBeUndefined();
    expect(measureNativeCanvasText(context(), '移出', -300, 200)).toBeUndefined();
    expect(measureNativeCanvasText(context(), '裁切', 50, 200)?.x0).toBe(-50);
  });
  it('reports the required rendered size so repair can correct both small labels and scaled text', () => {
    const actual = measureNativeCanvasText(context({ font: '44px "Test Font"', getTransform: () => ({ a: .5, b: 0, c: 0, d: .5, e: 0, f: 0 }) }), '试卷标题', 500, 200)!;
    expect(actual.fontSize).toBe(22);
    const layout = runInNewContext(creativeLayoutInspectionScript(24), {
      window: { __lemo: { texts: () => [], frameTexts: () => [actual] }, TEXTS() {} },
      document: { body: { querySelectorAll: () => [] }, querySelector: () => null, createTreeWalker: () => ({ nextNode: () => null }) },
      NodeFilter: { SHOW_TEXT: 4 }, innerWidth: 1920, innerHeight: 1080,
    });
    expect(layout.issues).toContain('文字过小（22px，至少24px；按最终画布缩放后计算）：试卷标题');
  });
  it('finds unsupported annotations and real overflow even when authored metadata omits or conceals them', () => {
    const actual = { ...measureNativeCanvasText(context(), '接触角 >150°', 1880, 200)!, clipped:true };
    const layout = runInNewContext(creativeLayoutInspectionScript(24), {
      window: { __lemo: { texts: () => [{ ...actual, text: '结论', x0: 100, x1: 500 }], frameTexts: () => [actual] }, TEXTS() {} },
      document: { body: { querySelectorAll: () => [] }, querySelector: () => null, createTreeWalker: () => ({ nextNode: () => null }) },
      NodeFilter: { SHOW_TEXT: 4 }, innerWidth: 1920, innerHeight: 1080,
    });
    expect(layout.issues).toContain('原生文字超出画布或边界为空：接触角 >150°');
    expect(layout.issues.some((issue:string)=>issue.startsWith('LEMO_TEXT_CLIPPED:'))).toBe(true);
    expect(creativeUnsupportedClaims(layout.text, '荷叶表面有微小凸起')).toEqual(['接触角 >150°']);
  });
});
