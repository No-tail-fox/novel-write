import { describe, expect, it } from 'vitest';
import { installNativeCanvasStateGuard } from '../src/shared/creative-animation/native-canvas-state';
function fixture() {
  class Context {
    depth = 0;
    save() { this.depth++; }
    restore() { this.depth = Math.max(0,this.depth-1); }
  }
  const guard = installNativeCanvasStateGuard(Context.prototype);
  return {guard,context:new Context()};
}
describe('native Canvas frame state contract', () => {
  it('accepts balanced repeated seeks in arbitrary order', () => {
    const {guard,context} = fixture();
    for (const t of [0,.44445,17,5.2,0,20.8]) {
      guard.beginFrame(t); context.save(); context.save(); context.restore(); context.restore();
      expect(()=>guard.endFrame()).not.toThrow(); expect(context.depth).toBe(0);
    }
  });
  it('rejects an early-return save leak before the next seek and cleans its stack', () => {
    const {guard,context} = fixture();
    guard.beginFrame(.44445); context.save();
    expect(()=>guard.endFrame()).toThrow(/LEMO_CANVAS_STATE: render\(0.44445\).*restore/);
    expect(context.depth).toBe(0);
    guard.beginFrame(17); context.save(); context.restore(); expect(()=>guard.endFrame()).not.toThrow();
  });
  it('rejects restore underflow instead of stealing state from initialization', () => {
    const {guard,context} = fixture(); context.save();
    guard.beginFrame(1); expect(()=>context.restore()).toThrow(/没有对应 save/);
    guard.endFrame(); expect(context.depth).toBe(1);
  });
  it('keeps different canvases independent', () => {
    const {guard,context} = fixture(); const other = Object.create(Object.getPrototypeOf(context)); other.depth=0;
    guard.beginFrame(2); context.save(); expect(()=>other.restore()).toThrow(/LEMO_CANVAS_STATE/);
    expect(()=>guard.endFrame()).toThrow(/遗漏 1 次/);
  });
});
