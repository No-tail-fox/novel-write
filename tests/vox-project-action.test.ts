import { describe, expect, it } from 'vitest';
import { voxProjectAction } from '../src/features/director-desk/vox-project-action';

const ready = { shotCount: 3, busy: false, rendering: false, batchActive: false, canRender: true, outputReady: false };
describe('Vox fixed project action', () => {
  it('describes the actual render scope, including existing output', () => {
    expect(voxProjectAction(ready)).toEqual({ label: '生成现有镜头成片', disabled: false });
    expect(voxProjectAction({ ...ready, outputReady: true })).toEqual({ label: '重新生成现有镜头成片', disabled: false });
  });
  it.each([{ shotCount: 0 }, { busy: true }, { rendering: true }, { batchActive: true }, { canRender: false }])('prevents invalid or concurrent dispatch: %j', override => {
    expect(voxProjectAction({ ...ready, ...override }).disabled).toBe(true);
  });
  it('reports the active operation rather than offering a duplicate run', () => {
    expect(voxProjectAction({ ...ready, rendering: true }).label).toBe('正在生成成片…');
    expect(voxProjectAction({ ...ready, batchActive: true }).label).toBe('批量制作进行中');
  });
});
