import { describe, expect, it } from 'vitest';
import {
  createDirectorBatchController,
  createDirectorBatchPlan,
  directorBatchHistoryDemand,
  runDirectorBatchPlan,
  type DirectorBatchCapability,
  type DirectorBatchNode,
  type DirectorBatchShotState,
} from '../src/features/director-desk/director-batch';

describe('director batch planning', () => {
  it('budgets each dialogue recording and the final quality report', () => {
    const demand = directorBatchHistoryDemand([node('image', 'a'), node('voice', 'a'), node('voice', 'b'), node('render')], [
      { id: 'a', voiceGenerationCount: 3 }, { id: 'b', voiceGenerationCount: 2 },
    ]);
    expect(demand).toEqual({ assets: 7, providerJobs: 7, qualityReports: 1 });
    expect(directorBatchHistoryDemand([node('voice', 'a')], [{ id: 'a', voiceGenerationCount: 0 }])).toEqual({ assets: 0, providerJobs: 0, qualityReports: 0 });
  });

  it('builds the exact DAG for deterministic, living-poster, and hybrid shots', () => {
    const plan = createDirectorBatchPlan({
      scope: 'all',
      capabilities: { image: true, video: true, voice: true, render: true },
      shots: [
        shot({ id: 'det', title: '确定性镜头', renderStrategy: 'deterministic-layers' }),
        shot({ id: 'poster', title: '动态海报', renderStrategy: 'living-poster' }),
        shot({ id: 'hybrid', title: '混合镜头', renderStrategy: 'hybrid' }),
      ],
      outputReady: true,
    });

    expect(plan.nodes.map(({ id, dependencies }) => ({ id, dependencies }))).toEqual([
      { id: 'batch:image:det', dependencies: [] },
      { id: 'batch:voice:det', dependencies: [] },
      { id: 'batch:image:poster', dependencies: [] },
      { id: 'batch:voice:poster', dependencies: [] },
      { id: 'batch:video:poster', dependencies: ['batch:image:poster'] },
      { id: 'batch:image:hybrid', dependencies: [] },
      { id: 'batch:voice:hybrid', dependencies: [] },
      { id: 'batch:video:hybrid', dependencies: ['batch:image:hybrid'] },
      {
        id: 'batch:render:project',
        dependencies: [
          'batch:image:det',
          'batch:voice:det',
          'batch:image:poster',
          'batch:voice:poster',
          'batch:video:poster',
          'batch:image:hybrid',
          'batch:voice:hybrid',
          'batch:video:hybrid',
        ],
      },
    ]);
    expect(plan).toMatchObject({ imageCount: 3, videoCount: 2, voiceCount: 3, renderCount: 1 });
  });

  it('auto-adds a missing first-frame image before dynamic video', () => {
    const plan = createDirectorBatchPlan({
      scope: 'missing',
      capabilities: { image: false, video: true, voice: false, render: false },
      shots: [shot({
        id: 'missing-frame',
        renderStrategy: 'living-poster',
        imageReady: false,
        videoReady: false,
        estimatedImageCost: 0.125,
        estimatedVideoCost: 0.875,
      })],
      outputReady: false,
    });

    expect(plan.nodes.map(({ id, dependencies }) => ({ id, dependencies }))).toEqual([
      { id: 'batch:image:missing-frame', dependencies: [] },
      { id: 'batch:video:missing-frame', dependencies: ['batch:image:missing-frame'] },
    ]);
    expect(plan).toMatchObject({ estimatedCost: 1, imageCount: 1, videoCount: 1, voiceCount: 0, renderCount: 0 });
  });

  it('uses an existing first frame directly unless image regeneration is planned', () => {
    const existingFrame = shot({
      id: 'existing-frame',
      renderStrategy: 'hybrid',
      imageReady: true,
      videoReady: false,
    });
    const missing = createDirectorBatchPlan({
      scope: 'missing',
      capabilities: { image: true, video: true, voice: false, render: false },
      shots: [existingFrame],
      outputReady: false,
    });
    const regenerate = createDirectorBatchPlan({
      scope: 'all',
      capabilities: { image: true, video: true, voice: false, render: false },
      shots: [existingFrame],
      outputReady: false,
    });

    expect(missing.nodes.map(({ id, dependencies }) => ({ id, dependencies }))).toEqual([
      { id: 'batch:video:existing-frame', dependencies: [] },
    ]);
    expect(regenerate.nodes.map(({ id, dependencies }) => ({ id, dependencies }))).toEqual([
      { id: 'batch:image:existing-frame', dependencies: [] },
      { id: 'batch:video:existing-frame', dependencies: ['batch:image:existing-frame'] },
    ]);
  });

  it('makes render depend on every media node and includes all planned costs', () => {
    const plan = createDirectorBatchPlan({
      scope: 'missing',
      capabilities: { image: true, video: true, voice: true, render: true },
      shots: [shot({
        id: 'costed',
        renderStrategy: 'living-poster',
        imageReady: false,
        videoReady: false,
        voiceReady: false,
        estimatedImageCost: 0.11111,
        estimatedVideoCost: 0.22222,
        estimatedVoiceCost: 0.33333,
      })],
      outputReady: false,
    });

    expect(plan.nodes.at(-1)).toMatchObject({
      id: 'batch:render:project',
      dependencies: ['batch:image:costed', 'batch:voice:costed', 'batch:video:costed'],
    });
    expect(plan).toMatchObject({
      estimatedCost: 0.6667,
      imageCount: 1,
      videoCount: 1,
      voiceCount: 1,
      renderCount: 1,
    });
  });
});

describe('director batch DAG execution', () => {
  it('persists the running state before invoking a provider', async () => {
    let release: (() => void) | undefined;
    let started = false;
    const running = runDirectorBatchPlan([node('image', 'first')], { image: async () => { started = true; } }, {
      onStateChange: async (snapshot) => {
        if (snapshot[0].status === 'running') await new Promise<void>((resolve) => { release = resolve; });
      },
    });
    try {
      await waitFor(() => Boolean(release));
      expect(started).toBe(false);
    } finally { release?.(); }
    expect((await running).completed).toBe(1);
    expect(started).toBe(true);
  });

  it('stops dispatching when the running state cannot be saved', async () => {
    const calls: string[] = [];
    await expect(runDirectorBatchPlan(Array.from({ length: 20 }, (_, index) => node('image', String(index))), {
      image: async (item) => { calls.push(item.id); },
    }, { concurrency: 4, onStateChange: async () => { throw new Error('disk write failed'); } })).rejects.toThrow('disk write failed');
    expect(calls).toEqual([]);
  });

  it('does not start dependent work when saving completion fails', async () => {
    const calls: string[] = [];
    const first = node('image', 'first');
    const second = node('video', 'second', [first.id]);
    await expect(runDirectorBatchPlan([first, second], {
      image: async (item) => { calls.push(item.id); }, video: async (item) => { calls.push(item.id); },
    }, { onStateChange: async (snapshot) => { if (snapshot[0].status === 'completed') throw new Error('completion write failed'); } })).rejects.toThrow('completion write failed');
    expect(calls).toEqual([first.id]);
  });

  it.each(['pause', 'cancel'] as const)('honors %s while the running snapshot is being saved', async (intent) => {
    const controller = createDirectorBatchController();
    const calls: string[] = [];
    let release: (() => void) | undefined;
    let writes = 0;
    let lastStatus = '';
    const execution = runDirectorBatchPlan([node('image', 'first')], {
      image: async (item) => { calls.push(item.id); },
    }, { controller, onStateChange: async (snapshot) => {
      if (writes++ === 0) await new Promise<void>((resolve) => { release = resolve; });
      lastStatus = snapshot[0].status;
    } });
    try {
      await waitFor(() => Boolean(release));
      controller[intent]();
      release!();
      await waitFor(() => lastStatus === (intent === 'pause' ? 'pending' : 'cancelled'));
      expect(calls).toEqual([]);
    } finally {
      release?.();
      controller.resume();
    }
    const summary = await execution;
    expect(summary.completed).toBe(intent === 'pause' ? 1 : 0);
    expect(summary.cancelled).toBe(intent === 'cancel' ? 1 : 0);
  });

  it('waits for existing provider calls before exposing a persistence failure', async () => {
    let releaseProvider: () => void = () => undefined;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const calls: string[] = [];
    let failedWrite = false;
    let settled = false;
    let failure: unknown;
    const execution = runDirectorBatchPlan([node('image', 'first'), node('image', 'second'), node('image', 'third')], {
      image: async (item) => { calls.push(item.id); await providerGate; },
    }, { concurrency: 2, onStateChange: (snapshot) => {
      if (snapshot[1].status === 'running') { failedWrite = true; throw new Error('write unavailable'); }
    } }).then(() => { settled = true; }, (error) => { failure = error; settled = true; });
    try {
      await waitFor(() => failedWrite);
      await delay(5);
      expect(settled).toBe(false);
      expect(calls).toEqual(['batch:image:first']);
    } finally { releaseProvider(); }
    await execution;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('write unavailable');
    expect(calls).toEqual(['batch:image:first']);
  });

  it('bounds unsaved transitions by concurrency on a 1501-node project', async () => {
    const plan = createDirectorBatchPlan({
      scope: 'all', capabilities: { image: true, video: true, voice: true, render: true }, outputReady: false,
      shots: Array.from({ length: 500 }, (_, index) => shot({ id: String(index), renderStrategy: 'living-poster' })),
    });
    let pendingWrites = 0;
    let maximumWrites = 0;
    const saved = new Map<string, string>();
    const calls: string[] = [];
    const handler = async (item: DirectorBatchNode) => {
      expect(saved.get(item.id)).toBe('running');
      for (const dependency of item.dependencies) expect(saved.get(dependency)).toBe('completed');
      calls.push(item.id);
    };
    const result = await runDirectorBatchPlan(plan.nodes, { image: handler, video: handler, voice: handler, render: handler }, {
      concurrency: 4,
      onUpdate: () => { maximumWrites = Math.max(maximumWrites, ++pendingWrites); },
      onStateChange: async (snapshot) => {
        await Promise.resolve();
        snapshot.forEach((item) => saved.set(item.id, item.status));
        pendingWrites -= 1;
      },
    });
    expect(result.completed).toBe(1501);
    expect(new Set(calls).size).toBe(1501);
    expect(calls.at(-1)).toBe('batch:render:project');
    expect(maximumWrites).toBeLessThanOrEqual(4);
    expect(pendingWrites).toBe(0);
  });

  it('resumes a persisted DAG without repeating completed nodes and persists ordered transitions', async () => {
    const snapshots: string[][] = [];
    const source = [node('image', 'done'), node('image', 'next', ['batch:image:done'])];
    const result = await runDirectorBatchPlan(source, {
      image: async () => undefined,
    }, {
      initialNodes: [
        { ...source[0], status: 'completed' },
        { ...source[1], status: 'running' },
      ],
      onStateChange: (nodes) => { snapshots.push(nodes.map((item) => `${item.id}:${item.status}`)); },
    });

    expect(result.completed).toBe(2);
    expect(snapshots[0]).toEqual(['batch:image:done:completed', 'batch:image:next:running']);
    expect(snapshots.at(-1)).toEqual(['batch:image:done:completed', 'batch:image:next:completed']);
  });

  it('keeps persisted failures and cancellations terminal during recovery', async () => {
    const source = [node('image', 'done'), node('image', 'failed'), node('image', 'cancelled')];
    const calls: string[] = [];
    const result = await runDirectorBatchPlan(source, { image: async (item) => { calls.push(item.id); } }, {
      initialNodes: [
        { ...source[0], status: 'completed' },
        { ...source[1], status: 'failed', error: 'provider failed' },
        { ...source[2], status: 'cancelled', error: 'cancelled by user' },
      ],
    });
    expect(calls).toEqual([]);
    expect(result.nodes.map((item) => item.status)).toEqual(['completed', 'failed', 'cancelled']);
  });

  it('refills concurrency slots while preserving image-before-video and render ordering', async () => {
    let releaseSlowImage: () => void = () => undefined;
    const slowImageGate = new Promise<void>((resolve) => { releaseSlowImage = resolve; });
    const events: string[] = [];
    let active = 0;
    let maximum = 0;

    const result = await runDirectorBatchPlan([
      node('image', 'fast'),
      node('image', 'slow'),
      node('video', 'fast', ['batch:image:fast']),
      node('render', undefined, ['batch:image:fast', 'batch:image:slow', 'batch:video:fast']),
    ], {
      image: async (item) => {
        active += 1;
        maximum = Math.max(maximum, active);
        events.push(`start:${item.id}`);
        if (item.shotId === 'slow') await slowImageGate;
        else await delay(5);
        events.push(`done:${item.id}`);
        active -= 1;
      },
      video: async (item) => {
        expect(events).toContain('done:batch:image:fast');
        expect(events).not.toContain('done:batch:image:slow');
        active += 1;
        maximum = Math.max(maximum, active);
        events.push(`start:${item.id}`);
        releaseSlowImage();
        await delay(2);
        events.push(`done:${item.id}`);
        active -= 1;
      },
      render: async (item) => {
        expect(active).toBe(0);
        expect(events).toContain('done:batch:image:slow');
        expect(events).toContain('done:batch:video:fast');
        events.push(`start:${item.id}`);
      },
    }, { concurrency: 2 });

    expect(maximum).toBe(2);
    expect(events.indexOf('done:batch:image:fast')).toBeLessThan(events.indexOf('start:batch:video:fast'));
    expect(events.at(-1)).toBe('start:batch:render:project');
    expect(result).toMatchObject({ completed: 4, failed: 0, cancelled: 0, skipped: 0 });
  });

  it('skips video and render after an image failure while independent voice completes', async () => {
    const started: string[] = [];
    const result = await runDirectorBatchPlan([
      node('image', 'shot-1'),
      node('voice', 'shot-1'),
      node('video', 'shot-1', ['batch:image:shot-1']),
      node('render', undefined, ['batch:image:shot-1', 'batch:voice:shot-1', 'batch:video:shot-1']),
    ], {
      image: async (item) => { started.push(item.id); throw new Error('image provider failed'); },
      voice: async (item) => { started.push(item.id); },
      video: async (item) => { started.push(item.id); },
      render: async (item) => { started.push(item.id); },
    }, { concurrency: 2 });

    expect(started).toEqual(['batch:image:shot-1', 'batch:voice:shot-1']);
    expect(result).toMatchObject({ completed: 1, failed: 1, cancelled: 0, skipped: 2 });
    expect(result.nodes.find((item) => item.id === 'batch:image:shot-1')).toMatchObject({
      status: 'failed',
      error: 'image provider failed',
    });
    expect(result.nodes.find((item) => item.id === 'batch:video:shot-1')).toMatchObject({ status: 'skipped' });
    expect(result.nodes.find((item) => item.id === 'batch:render:project')).toMatchObject({ status: 'skipped' });
  });

  it('fails a cycle when no node can become runnable', async () => {
    const result = await runDirectorBatchPlan([
      node('image', 'a', ['batch:voice:b']),
      node('voice', 'b', ['batch:image:a']),
    ], {
      image: async () => undefined,
      voice: async () => undefined,
    });

    expect(result).toMatchObject({ completed: 0, failed: 2, cancelled: 0, skipped: 0 });
    expect(result.nodes.every((item) => item.error === '检测到循环或无法解析的批处理依赖。')).toBe(true);
  });

  it('lets in-flight work finish while paused and starts no new work until resume', async () => {
    const controller = createDirectorBatchController();
    controller.pause();
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started: string[] = [];
    const completed: string[] = [];
    const execution = runDirectorBatchPlan([
      node('image', 'shot-1'),
      node('image', 'shot-2'),
    ], {
      image: async (item) => {
        started.push(item.id);
        if (item.shotId === 'shot-1') await firstGate;
        completed.push(item.id);
      },
    }, { concurrency: 1, controller });

    await delay(5);
    expect(started).toEqual([]);
    controller.resume();
    await waitFor(() => started.length === 1);
    controller.pause();
    releaseFirst();
    await waitFor(() => completed.length === 1);
    await delay(5);
    expect(started).toEqual(['batch:image:shot-1']);
    controller.resume();

    const result = await execution;
    expect(started).toEqual(['batch:image:shot-1', 'batch:image:shot-2']);
    expect(result).toMatchObject({ completed: 2, failed: 0, cancelled: 0, skipped: 0 });
  });

  it('cancels pending nodes without pretending that in-flight work was aborted', async () => {
    const controller = createDirectorBatchController();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    const execution = runDirectorBatchPlan([
      node('image', 'shot-1'),
      node('image', 'shot-2', ['batch:image:shot-1']),
      node('image', 'shot-3'),
    ], {
      image: async (item) => { started.push(item.id); await gate; },
    }, { concurrency: 1, controller });

    await waitFor(() => started.length === 1);
    controller.cancel();
    release();
    const result = await execution;

    expect(started).toEqual(['batch:image:shot-1']);
    expect(result).toMatchObject({ completed: 1, cancelled: 2, failed: 0, skipped: 0 });
  });

  it('treats dependencies omitted from a retry subgraph as externally satisfied', async () => {
    const started: string[] = [];
    const result = await runDirectorBatchPlan([
      node('video', 'retry', ['batch:image:retry']),
    ], {
      video: async (item) => { started.push(item.id); },
    });

    expect(started).toEqual(['batch:video:retry']);
    expect(result).toMatchObject({ completed: 1, failed: 0, cancelled: 0, skipped: 0 });
  });
});

function shot(overrides: Partial<DirectorBatchShotState> = {}): DirectorBatchShotState {
  return {
    id: 'shot-1',
    title: '镜头一',
    renderStrategy: 'deterministic-layers',
    imageReady: true,
    videoReady: true,
    voiceReady: true,
    imageFailed: false,
    videoFailed: false,
    voiceFailed: false,
    estimatedImageCost: 0,
    estimatedVideoCost: 0,
    estimatedVoiceCost: 0,
    ...overrides,
  };
}

function node(
  capability: DirectorBatchCapability,
  shotId?: string,
  dependencies: string[] = [],
): DirectorBatchNode {
  return {
    id: capability === 'render' ? 'batch:render:project' : `batch:${capability}:${shotId}`,
    capability,
    ...(shotId ? { shotId } : {}),
    title: capability === 'render' ? '生成成片' : `${shotId} ${capability}`,
    status: 'pending',
    estimatedCost: 0,
    dependencies,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for batch state');
    await delay(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
