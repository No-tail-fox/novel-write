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
  it('accepts legacy web searches and strictly validates explicit provider requests', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;
    const schema = contract.ipcInputSchemas['research:web-search'];

    expect(schema.parse('李在明')).toBe('李在明');
    expect(schema.parse({ query: '李在明 生平', providers: ['bing', 'baidu', 'sogou', 'toutiao'] })).toEqual({
      query: '李在明 生平',
      providers: ['bing', 'baidu', 'sogou', 'toutiao'],
    });
    expect(() => schema.parse({ query: '李在明', providers: [] })).toThrow();
    expect(() => schema.parse({ query: '李在明', providers: ['bing', 'bing'] })).toThrow();
    expect(() => schema.parse({ query: '李在明', providers: ['google'] })).toThrow();
    expect(() => schema.parse({ query: '李在明', providers: ['bing'], extra: true })).toThrow();
  });

  it('requires a strict previous composite identity for book selection updates', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;
    const schema = contract.ipcInputSchemas['book-selection:save'];
    const input = { theme: 'new-theme', bookId: 'new-id', previousIdentity: { theme: 'old-theme', bookId: 'old-id' }, data: { name: 'Book' } };
    expect(schema.parse(input)).toEqual(input);
    expect(() => schema.parse({ ...input, previousIdentity: { ...input.previousIdentity, extra: true } })).toThrow();
    expect(() => schema.parse({ ...input, previousIdentity: { theme: '', bookId: 'old-id' } })).toThrow();
  });

  it('validates complete draft templates at every nested IPC boundary', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;
    const { draftTemplates } = await import('../src/shared/templates');
    const schema = contract.ipcInputSchemas['draft-template:save'];

    expect(schema.parse(structuredClone(draftTemplates[0]))).toEqual(draftTemplates[0]);
    expect(() => schema.parse({
      ...structuredClone(draftTemplates[0]),
      caption: { ...structuredClone(draftTemplates[0].caption), background: { ...draftTemplates[0].caption.background, extra: true } },
    })).toThrow();
    expect(() => schema.parse({
      ...structuredClone(draftTemplates[0]),
      image: { ...draftTemplates[0].image, animation: 'unknown-animation' },
    })).toThrow();
  });

  it('bounds task text, arrays, finite scene IDs, statuses, paths, and unknown fields', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    expect(contract.createTaskSchema.parse({ inputText: 'hello', aiSources: ['source'] })).toEqual({
      inputText: 'hello',
      aiSources: ['source'],
    });
    expect(contract.createTaskSchema.parse({ inputText: 'hello', coverPageEnabled: true, coverPageText: '封面标题' })).toMatchObject({
      coverPageEnabled: true,
      coverPageText: '封面标题',
    });
    expect(() => contract.createTaskSchema.parse({ inputText: 'hello', coverPageText: '字'.repeat(81) })).toThrow();
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
    const taskTemplateSchema = contract.ipcInputSchemas['task:update-template'];
    expect(taskTemplateSchema.parse({ id: 'task-1', templateId: 'custom-template' })).toEqual({ id: 'task-1', templateId: 'custom-template' });
    expect(() => taskTemplateSchema.parse({ id: 'task-1', templateId: '', extra: true })).toThrow();

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
    for (const invalidConfig of [
      { ttsProvider: 'unknown-provider' },
      { ttsSpeed: 0.09 },
      { ttsSpeed: 10.01 },
      { bgmVolume: 'silent' },
      { transitionType: 'unknown-transition' },
      { sceneMotion: 'unknown-motion' },
      { ratio: '3:2' },
      { unknownField: true },
    ]) {
      const invalidPipeline = workflow.createHtmlVideoPipelineData('hello');
      Object.assign(invalidPipeline.config, invalidConfig);
      expect(() => htmlVideoCreateSchema.parse({
        inputText: 'hello',
        pipelineData: JSON.stringify(invalidPipeline),
      })).toThrow();
    }
    expect(contract.createTaskSchema.parse({
      inputText: 'hello',
      ttsProvider: 'volcengine',
      ttsSpeed: 0.1,
    })).toMatchObject({ ttsProvider: 'volcengine', ttsSpeed: 0.1 });
    expect(() => contract.createTaskSchema.parse({ inputText: 'hello', ttsProvider: 'unknown-provider' })).toThrow();
    expect(() => contract.createTaskSchema.parse({ inputText: 'hello', ttsSpeed: 10.01 })).toThrow();
    expect(htmlVideoCreateSchema.parse({
      inputText: 'hello',
      targetScenes: 30,
      storyboardSceneCount: 30,
    })).toMatchObject({ targetScenes: 30, storyboardSceneCount: 30 });

    const htmlVideoUpdateSchema = contract.ipcInputSchemas['html-video:update-config'];
    expect(htmlVideoUpdateSchema.parse({
      id: 'html-task-1',
      changes: [
        { field: 'ttsProvider', value: 'minimax' },
        { field: 'ttsSpeed', value: 1.25 },
        { field: 'bgmVolume', value: 'medium' },
        { field: 'transitionType', value: 'dissolve' },
        { field: 'sceneMotion', value: 'zoom_pan_up' },
        { field: 'ratio', value: '4:3' },
        { field: 'captionPreset', value: 'editorial' },
        { field: 'captionAnim', value: 'pop' },
        { field: 'captionColors', value: { text: '#ffffff', accent: '#11aabb' } },
        { field: 'coverImageMode', value: 'manual' },
        { field: 'coverTemplate', value: 'cinematic-poster' },
        { field: 'coverRatio', value: '3:4' },
        { field: 'coverPrompt', value: 'cinematic cover prompt' },
        { field: 'draftTemplate', value: 'draft-1' },
      ],
    })).toMatchObject({ id: 'html-task-1' });
    for (const invalidChange of [
      { field: 'coverImageMode', value: 'custom' },
      { field: 'coverRatio', value: '4:5' },
      { field: 'ttsProvider', value: 'unknown-provider' },
      { field: 'ttsSpeed', value: 10.01 },
      { field: 'bgmVolume', value: 'silent' },
      { field: 'transitionType', value: 'unknown-transition' },
      { field: 'sceneMotion', value: 'unknown-motion' },
      { field: 'ratio', value: '3:2' },
      { field: 'captionPreset', value: 'vendor-preset' },
      { field: 'captionAnim', value: 'spin' },
      { field: 'captionColors', value: { width: '#ffffff' } },
      { field: 'captionColors', value: { text: 'red;url(javascript:1)' } },
      { field: 'unknownField', value: true },
    ]) {
      expect(() => htmlVideoUpdateSchema.parse({ id: 'html-task-1', changes: [invalidChange] })).toThrow();
    }
    expect(() => htmlVideoUpdateSchema.parse({ id: 'html-task-1', changes: [] })).toThrow();
    expect(() => htmlVideoUpdateSchema.parse({
      id: 'html-task-1',
      changes: [{ field: 'style', value: 'a' }, { field: 'style', value: 'b' }],
    })).toThrow();
    expect(htmlVideoUpdateSchema.parse({
      id: 'html-task-1',
      changes: [
        { field: 'style', value: 'editorial' },
        { field: 'voiceId', value: 'voice' },
        { field: 'ttsProvider', value: 'minimax' },
        { field: 'ttsSpeed', value: 1.1 },
        { field: 'bgmId', value: '' },
        { field: 'captionPreset', value: 'classic' },
        { field: 'captionAnim', value: 'none' },
        { field: 'captionColors', value: { shadow: '#000000aa' } },
        { field: 'bgmVolume', value: 'soft' },
        { field: 'transitionType', value: 'fade' },
        { field: 'sceneMotion', value: 'auto' },
        { field: 'coverImageMode', value: 'off' },
        { field: 'coverTemplate', value: 'cinematic-poster' },
        { field: 'coverRatio', value: '3:4' },
        { field: 'coverPrompt', value: '' },
        { field: 'draftTemplate', value: '' },
        { field: 'foreground', value: true },
        { field: 'maxScenes', value: 8 },
        { field: 'ratio', value: '9:16' },
      ],
    }).changes).toHaveLength(19);

    expect(contract.ipcInputSchemas['html-video:add-asset'].parse({
      id: 'html-task-1',
      sceneIndex: 1,
      prompt: 'transparent foreground subject',
    })).toMatchObject({ sceneIndex: 1 });
    expect(contract.ipcInputSchemas['html-video:regenerate-cover'].parse('html-task-1')).toBe('html-task-1');

    const importCoverSchema = contract.ipcInputSchemas['html-video:import-cover'];
    expect(importCoverSchema.parse('html-task-1')).toBe('html-task-1');
    expect(() => importCoverSchema.parse('')).toThrow();
    expect(() => importCoverSchema.parse({ id: 'html-task-1', sourcePath: 'C:/outside.png' })).toThrow();

    const ordinaryImportCoverSchema = contract.ipcInputSchemas['task:import-cover'];
    expect(ordinaryImportCoverSchema.parse('9:16')).toBe('9:16');
    expect(() => ordinaryImportCoverSchema.parse({ ratio: '9:16', sourcePath: 'C:/outside.png' })).toThrow();

    expect(contract.ipcInputSchemas['task:regenerate-images'].parse({
      id: 'task-1',
      sceneIds: [1, 2, 3],
    })).toEqual({ id: 'task-1', sceneIds: [1, 2, 3] });
    expect(contract.ipcInputSchemas['task:replace-image'].parse({
      id: 'task-1',
      sceneId: 2,
      source: { kind: 'image-lab', recordId: 'image-1' },
    })).toMatchObject({ sceneId: 2, source: { kind: 'image-lab' } });
    expect(contract.ipcInputSchemas['task:replace-image'].parse({
      id: 'task-1',
      sceneId: 2,
      source: { kind: 'scene', sourceSceneId: 1 },
    })).toMatchObject({ source: { sourceSceneId: 1 } });
    expect(contract.ipcInputSchemas['task:import-images'].parse('task-1')).toBe('task-1');
    expect(contract.ipcInputSchemas['task:reference-edit-image'].parse({
      id: 'task-1',
      sceneId: 2,
      prompt: 'keep the subject and change the lighting',
    })).toMatchObject({ sceneId: 2 });
    expect(() => contract.ipcInputSchemas['task:regenerate-images'].parse({ id: 'task-1', sceneIds: [] })).toThrow();
    expect(() => contract.ipcInputSchemas['task:replace-image'].parse({ id: 'task-1', sceneId: 2, source: { kind: 'path', path: 'C:/outside.png' } })).toThrow();

    expect(contract.createTaskSchema.parse({
      inputText: 'hello',
      targetScenes: 500,
      storyboardSceneCount: 500,
      imageQuality: 'low',
    })).toMatchObject({ targetScenes: 500, storyboardSceneCount: 500, imageQuality: 'low' });
    expect(() => contract.createTaskSchema.parse({ inputText: 'hello', imageProfileId: 'image-custom' })).toThrow();
    expect(() => contract.createTaskSchema.parse({ inputText: 'hello', imageResolution: '4K' })).toThrow();
    expect(contract.ipcInputSchemas['image-lab:generate'].parse({
      prompt: 'portrait',
      ratio: '1:1',
      style: 'photo-real',
      provider: 'gpt_image',
      resolution: '2K',
      quality: 'high',
    })).toMatchObject({ quality: 'high' });
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
        selectedSources: [{
          source: 'web',
          provider: 'baidu',
          title: 'Title',
          url: 'https://baijiahao.baidu.com/s?id=1',
          snippet: 'Search result summary',
          content: 'Body',
        }],
        useBuiltinKnowledge: false,
        targetLength: 1200,
      }),
    ).toMatchObject({
      keyword: 'topic',
      targetLength: 1200,
      selectedSources: [{ provider: 'baidu' }],
      useBuiltinKnowledge: false,
    });
    expect(contract.researchCopyComposeSchema.parse({
      keyword: 'topic',
      extraRequirements: '',
      selectedSources: [],
      useBuiltinKnowledge: true,
    })).toMatchObject({ selectedSources: [], useBuiltinKnowledge: true });
    expect(() => contract.researchCopyComposeSchema.parse({
      keyword: 'topic',
      extraRequirements: '',
      selectedSources: [],
    })).toThrow();
    expect(() => contract.researchCopyComposeSchema.parse({
      keyword: 'topic',
      extraRequirements: '',
      selectedSources: [{ source: 'web', provider: 'unknown', title: 'Title', content: 'Body' }],
      useBuiltinKnowledge: false,
    })).toThrow();
    expect(
      contract.createViralAnalysisSchema.parse({
        url: 'https://www.douyin.com/video/1',
        platform: 'douyin',
        settings: { track: 'story', style: 'realistic', ratio: '9:16', templateId: 'default' },
      }),
    ).toMatchObject({ platform: 'douyin' });
  });

  it('enforces strict family-specific history list filters and bounded pagination', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    const parseIpcInput = (channel: keyof typeof contract.ipcInputSchemas, input: unknown) =>
      contract.ipcInputSchemas[channel].parse(input);
    const taskRequest = { family: 'task', filter: 'active' };

    expect(parseIpcInput('task:list', taskRequest)).toEqual(taskRequest);
    expect(parseIpcInput('task:list', { ...taskRequest, taskType: 'html-video', statuses: ['pending', 'running'] })).toMatchObject({
      family: 'task',
      taskType: 'html-video',
      statuses: ['pending', 'running'],
    });
    expect(parseIpcInput('viral:list', { family: 'viral-analysis', filter: 'archived', status: 'completed' })).toMatchObject({
      family: 'viral-analysis',
      status: 'completed',
    });
    expect(parseIpcInput('image-lab:list', { family: 'image-lab', filter: 'active', status: 'generated' })).toMatchObject({
      family: 'image-lab',
      status: 'generated',
    });
    expect(parseIpcInput('voice-lab:list', { family: 'voice-lab', filter: 'active', status: 'failed' })).toMatchObject({
      family: 'voice-lab',
      status: 'failed',
    });

    expect(() => parseIpcInput('task:list', { ...taskRequest, extra: true })).toThrow();
    expect(() => parseIpcInput('viral:list', { family: 'viral-analysis', filter: 'active', extra: true })).toThrow();
    expect(() => parseIpcInput('image-lab:list', { family: 'image-lab', filter: 'active', extra: true })).toThrow();
    expect(() => parseIpcInput('voice-lab:list', { family: 'voice-lab', filter: 'active', extra: true })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, family: 'voice-lab' })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, status: 'mock' })).toThrow();
    expect(() => parseIpcInput('viral:list', { family: 'viral-analysis', filter: 'active', status: 'draft' })).toThrow();
    expect(() => parseIpcInput('image-lab:list', { family: 'image-lab', filter: 'active', status: 'running' })).toThrow();
    expect(() => parseIpcInput('voice-lab:list', { family: 'voice-lab', filter: 'active', status: 'mock' })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, status: 'running', statuses: ['paused'] })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, statuses: [] })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, statuses: ['running', 'running'] })).toThrow();
    expect(() =>
      parseIpcInput('task:list', {
        ...taskRequest,
        statuses: ['draft', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'draft'],
      }),
    ).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, taskType: 'legacy' })).toThrow();

    expect(parseIpcInput('task:list', { ...taskRequest, limit: 1 })).toMatchObject({ limit: 1 });
    expect(parseIpcInput('task:list', { ...taskRequest, limit: 100 })).toMatchObject({ limit: 100 });
    expect(() => parseIpcInput('task:list', { ...taskRequest, limit: 0 })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, limit: 1.5 })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, limit: 101 })).toThrow();

    const maxQuery = 'q'.repeat(256);
    expect(parseIpcInput('task:list', { ...taskRequest, query: `  ${maxQuery}  ` })).toMatchObject({ query: maxQuery });
    expect(parseIpcInput('task:list', { ...taskRequest, query: '   ' })).toMatchObject({ query: undefined });
    expect(() => parseIpcInput('task:list', { ...taskRequest, query: 'q'.repeat(257) })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, query: ' '.repeat(contract.MAX_IPC_TEXT + 1) })).toThrow();
    expect(parseIpcInput('task:list', { ...taskRequest, cursor: null })).toMatchObject({ cursor: null });
    expect(() => parseIpcInput('task:list', { ...taskRequest, cursor: '' })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, cursor: '   ' })).toThrow();
    expect(() => parseIpcInput('task:list', { ...taskRequest, cursor: 'c'.repeat(4097) })).toThrow();
  });

  it('uses a dedicated safe governance id for every archive, restore, and delete channel', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    const channels = [
      'task:archive',
      'task:restore',
      'task:delete',
      'viral:archive',
      'viral:restore',
      'viral:delete',
      'image-lab:archive',
      'image-lab:restore',
      'image-lab:delete',
      'voice-lab:archive',
      'voice-lab:restore',
      'voice-lab:delete',
      'draft-template:delete',
    ] as const;
    const invalidIds = [
      '',
      '.',
      '..',
      '../outside',
      '..\\outside',
      'folder/id',
      'folder\\id',
      '/absolute',
      'C:\\absolute',
      '\\\\server\\share',
      'CON',
      'con.txt',
      'PRN',
      'AUX.json',
      'NUL',
      'COM1',
      'com9.log',
      'LPT1',
      'lpt9.txt',
      'x'.repeat(257),
    ];

    for (const channel of channels) {
      const schema = contract.ipcInputSchemas[channel];
      expect(schema.parse('safe_ID-123')).toBe('safe_ID-123');
      expect(schema.parse('x'.repeat(256))).toHaveLength(256);
      for (const id of invalidIds) expect(() => schema.parse(id)).toThrow();
    }

    expect(contract.ipcInputSchemas['task:get-detail'].parse('legacy/path')).toBe('legacy/path');
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

  it('separates navigation and theme preference writes', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    const schema = contract.ipcInputSchemas['ui:save-preferences'];
    expect(schema.parse({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(schema.parse({ activeView: 'settings' })).toEqual({ activeView: 'settings' });
    expect(() => schema.parse({ theme: 'light', activeView: 'settings' })).toThrow();
    expect(() => schema.parse({ themePreferenceVersion: 1 })).toThrow();
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
