import { describe, expect, it } from 'vitest';

async function loadContract() {
  return import('../src/shared/ipc-contract').catch(() => null);
}

async function loadGateway() {
  return import('../electron/ipc').catch(() => null);
}

async function loadStoryDreamApiContract() {
  return import('../src/shared/storydream-api').catch(() => null);
}

describe('IPC runtime contract', () => {
  it('bounds task text, arrays, finite scene IDs, statuses, paths, and unknown fields', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    expect(contract.createTaskSchema.parse({ inputText: 'hello', aiSources: ['source'] })).toEqual({
      inputText: 'hello',
      aiSources: ['source'],
    });
    expect(() => contract.createTaskSchema.parse({ inputText: '' })).toThrow();
    expect(() => contract.createTaskSchema.parse({ inputText: 'x'.repeat(contract.MAX_TASK_TEXT + 1) })).toThrow();
    expect(() =>
      contract.createTaskSchema.parse({
        inputText: 'hello',
        aiSources: Array.from({ length: contract.MAX_IPC_ARRAY_ITEMS + 1 }, (_, index) => `source-${index}`),
      }),
    ).toThrow();

    expect(contract.sceneActionSchema.parse({ id: 'task-1', sceneId: 2 })).toEqual({ id: 'task-1', sceneId: 2 });
    expect(() => contract.sceneActionSchema.parse({ id: 'task-1', sceneId: Infinity })).toThrow();
    expect(() => contract.sceneActionSchema.parse({ id: 'task-1', sceneId: 2, extra: true })).toThrow();

    expect(contract.taskStatusSchema.parse({ id: 'task-1', status: 'paused' })).toEqual({ id: 'task-1', status: 'paused' });
    expect(() => contract.taskStatusSchema.parse({ id: 'task-1', status: 'unknown' })).toThrow();
    expect(() => contract.taskStatusSchema.parse({ id: 'task-1', status: 'paused', extra: true })).toThrow();

    expect(contract.pathSchema.parse('I:/opc/tasks/task-1/output.mp4')).toBe('I:/opc/tasks/task-1/output.mp4');
    expect(() => contract.pathSchema.parse('../secret.txt')).toThrow();
    expect(() => contract.pathSchema.parse('I:/opc/tasks/../secret.txt')).toThrow();

    const htmlVideoCreateSchema = contract.ipcInputSchemas['html-video:create-task'];
    expect(() => htmlVideoCreateSchema.parse({ inputText: 'hello', pipelineData: '{' })).toThrow();
    expect(htmlVideoCreateSchema.parse({ inputText: 'hello' })).toMatchObject({ inputText: 'hello' });

    const workflow = await import('../src/shared/html-video-workflow');
    expect(workflow.MAX_HTML_VIDEO_SCENES).toBe(30);
    expect(workflow.MAX_HTML_VIDEO_SOURCE_CHARS).toBe(16_384);
    const oversizedPipeline = workflow.createHtmlVideoPipelineData('hello');
    oversizedPipeline.config.maxScenes = 31;
    expect(() => htmlVideoCreateSchema.parse({
      inputText: 'hello',
      pipelineData: JSON.stringify(oversizedPipeline),
    })).toThrow();
    expect(() => htmlVideoCreateSchema.parse({ inputText: 'hello', targetScenes: 31 })).toThrow();
    expect(() => htmlVideoCreateSchema.parse({ inputText: 'hello', storyboardSceneCount: 31 })).toThrow();
    expect(() => htmlVideoCreateSchema.parse({ inputText: 'x'.repeat(workflow.MAX_HTML_VIDEO_SOURCE_CHARS + 1) })).toThrow();
    expect(htmlVideoCreateSchema.parse({
      inputText: 'hello',
      targetScenes: 30,
      storyboardSceneCount: 30,
    })).toMatchObject({ targetScenes: 30, storyboardSceneCount: 30 });

    expect(contract.createTaskSchema.parse({
      inputText: 'hello',
      targetScenes: 500,
      storyboardSceneCount: 500,
    })).toMatchObject({ targetScenes: 500, storyboardSceneCount: 500 });
    expect(contract.createTaskSchema.parse({ inputText: 'x'.repeat(32_769) }).inputText).toHaveLength(32_769);
  });

  it('accepts current narrow provider, research, and viral payloads', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    expect(
      contract.providerModelListSchema.parse({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', protocol: 'openai' }),
    ).toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', protocol: 'openai' });
    expect(
      contract.researchCopyComposeSchema.parse({
        keyword: 'topic',
        extraRequirements: '',
        selectedSources: [{ source: 'web', title: 'Title', content: 'Body' }],
        targetLength: 1200,
      }),
    ).toMatchObject({ keyword: 'topic', targetLength: 1200 });
    expect(
      contract.createViralAnalysisSchema.parse({
        url: 'https://www.douyin.com/video/1',
        platform: 'douyin',
        settings: { track: 'story', style: 'realistic', ratio: '9:16', templateId: 'default' },
      }),
    ).toMatchObject({ platform: 'douyin' });
  });

  it('defines one runtime schema for every canonical invoke channel', async () => {
    const contract = await loadContract();
    const apiContract = await loadStoryDreamApiContract();
    expect(contract).not.toBeNull();
    expect(apiContract).not.toBeNull();
    if (!contract || !apiContract) return;

    expect(contract.IPC_CHANNELS).toBe(apiContract.INVOKE_CHANNELS);
    expect(new Set(Object.keys(contract.ipcInputSchemas))).toEqual(new Set(apiContract.INVOKE_CHANNELS));
  });

  it('rejects untrusted senders and invalid payloads before running handlers', async () => {
    const contract = await loadContract();
    const gateway = await loadGateway();
    expect(contract).not.toBeNull();
    expect(gateway).not.toBeNull();
    if (!contract || !gateway) return;

    const registrations = new Map<string, (event: unknown, raw?: unknown) => Promise<unknown>>();
    const mainFrame = { url: 'file:///app/dist-renderer/index.html' };
    const mainWebContents = { mainFrame, getURL: () => mainFrame.url };
    const attackerFrame = { url: 'https://evil.example/' };
    const attackerWebContents = { mainFrame: attackerFrame, getURL: () => attackerFrame.url };
    const win = { isDestroyed: () => false, webContents: mainWebContents };
    const policy = { mode: 'production' as const, entryUrl: mainFrame.url };

    const handle = gateway.createTrustedIpcRegistrar({
      register: (channel, handler) => registrations.set(channel, handler),
      getWindow: () => win,
      getPolicy: () => policy,
    });
    handle('app:get-state', async () => ({ ready: true }));
    handle('task:create-and-run', async (_event, input) => input);
    handle('diagnostics:run', async () => {
      throw new Error('diagnostic failed');
    });

    const invokeFrom = async (webContents: typeof mainWebContents, channel: string, raw?: unknown) => {
      const registered = registrations.get(channel);
      if (!registered) throw new Error(`Missing channel: ${channel}`);
      const result = await registered({ sender: webContents, senderFrame: webContents.mainFrame }, raw);
      return contract.unwrapIpcResult(result);
    };

    await expect(invokeFrom(attackerWebContents as typeof mainWebContents, 'app:get-state')).rejects.toThrow(/IPC_SENDER_REJECTED/);
    await expect(invokeFrom(mainWebContents, 'task:create-and-run', { inputText: '' })).rejects.toThrow(/IPC_INVALID_INPUT/);
    await expect(invokeFrom(mainWebContents, 'app:get-state')).resolves.toEqual({ ready: true });
    await expect(invokeFrom(mainWebContents, 'diagnostics:run')).rejects.toThrow(/IPC_HANDLER_FAILED/);
  });
});
