export function voxProjectAction(input: { shotCount: number; busy: boolean; rendering: boolean; batchActive: boolean; canRender: boolean; outputReady: boolean }) {
  return {
    label: input.rendering ? '正在生成成片…' : input.batchActive ? '批量制作进行中' : input.outputReady ? '重新生成现有镜头成片' : '生成现有镜头成片',
    disabled: input.shotCount === 0 || input.busy || input.rendering || input.batchActive || !input.canRender,
  };
}
