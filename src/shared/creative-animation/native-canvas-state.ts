/** Reject broken generated drawing code before it can poison subsequent seeks/capture. */
export function installNativeCanvasStateGuard(prototype: Pick<CanvasRenderingContext2D, 'save' | 'restore'>) {
  const save = prototype.save, restore = prototype.restore;
  let active = false, time = 0;
  const stacks = new Map<CanvasRenderingContext2D, string[]>();
  prototype.save = function(this: CanvasRenderingContext2D) {
    if (active) {
      const stack = stacks.get(this) ?? [];
      stack.push(new Error().stack ?? ''); stacks.set(this, stack);
    }
    return save.call(this);
  };
  prototype.restore = function(this: CanvasRenderingContext2D) {
    if (active) {
      const stack = stacks.get(this);
      if (!stack?.length) throw new Error('LEMO_CANVAS_STATE: render(' + time + ') 调用了没有对应 save() 的 restore()。每帧、每个绘图函数必须配对保存和恢复状态。');
      stack.pop();
    }
    return restore.call(this);
  };
  return {
    beginFrame(seconds: number) { stacks.clear(); time = seconds; active = true; },
    endFrame() {
      active = false;
      let diagnostic = '';
      for (const [context, stack] of stacks) {
        if (stack.length && !diagnostic) diagnostic = 'LEMO_CANVAS_STATE: render(' + time + ') 遗漏 ' + stack.length + ' 次 restore()；save/restore 不平衡会污染后续定位、字幕检查和导出。修复绘图函数，所有分支（含提前 return）均须恢复状态。首个未恢复 save(): ' + stack[0];
        // Cleanup is defensive only: the frame is rejected, never silently exported.
        for (let i = 0; i < stack.length; i++) restore.call(context);
      }
      stacks.clear();
      if (diagnostic) throw new Error(diagnostic);
    },
  };
}
