import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('product shell ui', () => {
  it('defines the complete Storybound-style navigation shell', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const view of ['new-task', 'queue', 'history', 'image-lab', 'prompt-templates', 'draft-templates', 'settings', 'account', 'activation']) {
      expect(main).toContain(view);
    }
    for (const text of ['新建任务', '任务队列', '历史任务', '画图实验室', '提示词模板', '草稿模板', '系统设置']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.app-shell');
    expect(css).toContain('--accent');
  });

  it('uses the dark renderer chrome as the only title bar and removes the trial strip', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain('window-control-button');
    expect(main).toContain("api.windowControl('minimize')");
    expect(main).toContain("api.windowControl('toggle-maximize')");
    expect(main).toContain("api.windowControl('close')");
    expect(main).not.toContain('className="trial-strip"');
    expect(main).not.toContain('className="activation-link"');
    expect(main).not.toContain('获取激活码');
    expect(css).toContain('grid-template-rows: 34px 1fr');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
    expect(css).not.toContain('.trial-strip');
    expect(css).not.toContain('.activation-link');
    expect(viteEnv).toContain("windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>");
  });

  it('gives the queue task list more horizontal room than the event history pane', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('className="queue-layout"');
    expect(css).toContain('.queue-layout');
    expect(css).toContain('grid-template-columns: minmax(520px, 1.35fr) minmax(320px, 0.75fr)');
  });

  it('presents draft templates as a gallery before opening the editor', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['默认竖屏', '竖屏4:3', '横屏16:9', '编辑', '复制', '新模板', '返回模板列表']) {
      expect(main).toContain(text);
    }

    expect(main).toContain('draft-template-gallery');
    expect(main).toContain('setEditingId');
    expect(css).toContain('.draft-template-gallery');
    expect(css).toContain('.draft-template-thumb');
  });

  it('supports dragging draft template regions directly on the preview canvas', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain("normalizeDraftTemplate");
    expect(main).toContain("draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate)");
    expect(main).toContain('EditableDraftCanvas');
    expect(main).toContain('DraftCanvasLayer');
    expect(main).toContain('handleDraftCanvasPointerDown');
    expect(main).toContain('onPointerMove');
    expect(main).toContain('setPointerCapture');
    expect(main).toContain('updateDraftLayerPosition');
    expect(main).toContain('坐标');
    expect(main).toContain("data-layer={layer}");
    expect(main).toContain('data-layer="image"');
    expect(css).toContain('.editable-draft-canvas');
    expect(css).toContain('.draft-layer');
    expect(css).toContain('.draft-layer.selected');
    expect(css).toContain('.draft-layer-handle');
  });

  it('does not reset unsaved draft template drag edits during state refreshes', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('[editingId]');
    expect(main).toContain('const currentEditingTemplate = state.draftTemplates.find');
    expect(main).not.toContain('[editingId, editingTemplate]');
  });

  it('applies draft canvas ratio changes and selects background images from the editor', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('applyDraftCanvasRatio');
    expect(main).toContain('draftCanvasSizeForRatio');
    expect(main).toContain('selectDraftBackgroundImage');
    expect(main).toContain('selectLocalImage');
    expect(main).toContain('draftTemplateCanvasStyle');
    expect(main).toContain('type="color"');
    expect(main).toContain('backgroundImage:');
    expect(main).toContain('draft-background-field');
    expect(css).toContain('.draft-background-field');
    expect(css).toContain('.draft-background-swatch');
  });

  it('sizes the draft preview from the canvas ratio instead of a fixed width', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('draftPreviewWidth');
    expect(main).toContain("'--draft-preview-width'");
    expect(main).toContain('ratioToNumber(template.canvas.ratio)');
    expect(css).toContain('width: min(100%, var(--draft-preview-width');
    expect(css).not.toContain('width: min(100%, 420px)');
  });

  it('auto-matches prompt templates from task track and exposes an advanced override', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('resolvePromptTemplateForTrack');
    expect(main).toContain('promptTemplateOverrideId');
    expect(main).toContain('prompt-template-selector');
    expect(main).toContain('提示词模板');
    expect(main).toContain('自动匹配赛道模板');
    expect(main).toContain('promptTemplateId: resolvedPromptTemplate?.id');
    expect(main).toContain("promptTemplateType: 'task'");
  });

  it('manages prompt templates with filters, metadata, variables, and clone-on-first-edit', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'createPromptTemplate',
      'exportPromptTemplateJson',
      'templateTypeFilter',
      'templateTrackFilter',
      'savePromptTemplateDraft',
      'baseTemplateId',
      'promptTemplateVariables',
    ]) {
      expect(main).toContain(symbol);
    }
    for (const text of ['新建模板', '导出 JSON', '类型筛选', '赛道筛选', '变量', '首次保存将创建自定义副本']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.template-filter-row');
    expect(css).toContain('.variable-chip-row');
  });

  it('supports opening a selected task in a screenshot-style pipeline detail view', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(types).toContain("'task-detail'");
    expect(main).toContain('selectedTaskId');
    expect(main).toContain('openTaskDetail');
    expect(main).toContain('TaskDetailPage');
    expect(main).toContain('pipelineSteps');
    for (const text of ['历史任务', '任务详情', '7 步流水线', '产物预览', '分镜画廊', '配音试听', '等待当前步骤产物落盘']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.task-detail-shell');
    expect(css).toContain('.pipeline-step');
    expect(css).toContain('.artifact-preview');
  });

  it('loads and renders all pipeline artifact steps in task detail preview tabs', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(preload).toContain('getTaskArtifacts');
    expect(electronMain).toContain('task:get-artifacts');
    expect(main).toContain('getTaskArtifacts');
    expect(main).toContain('ArtifactPreviewContent');
    for (const text of ['文案预审', '改写产物', '封面信息', '分镜分句', '绘图提示词', '批量生图', '配音字幕', '草稿输出']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.artifact-section');
    expect(css).toContain('.artifact-text-block');
    expect(css).toContain('.artifact-scene-list');
  });

  it('refreshes task artifact snapshots while image generation is still running', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('artifactRefreshKey');
    expect(main).toContain('artifactRefreshTick');
    expect(main).toContain('latestEvent?.id');
    expect(main).toContain('snapshotImageCount');
    expect(main).toContain('snapshotStepStatus(snapshot, 4)');
    expect(main).toContain('imageProgressLabel');
    expect(main).toContain('图片进度');
  });

  it('prioritizes every generated image in the storyboard gallery tab', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('ArtifactImageGallery');
    expect(main).toContain('storyboard-gallery-hero');
    expect(main).toContain('ArtifactSection title="全部图片"');
    expect(main).toContain('galleryItems');
    expect(main).toContain("artifact-image-card pending");
    expect(main).toContain('等待生成');
    const galleryIndex = main.indexOf('storyboard-gallery-hero');
    const allImagesIndex = main.indexOf('ArtifactSection title="全部图片"', galleryIndex);
    const scenesIndex = main.indexOf('ArtifactSection title="分镜分句"', allImagesIndex);
    expect(allImagesIndex).toBeGreaterThan(galleryIndex);
    expect(scenesIndex).toBeGreaterThan(allImagesIndex);
    expect(css).toContain('.artifact-image-gallery');
    expect(css).toContain('.artifact-image-card');
    expect(css).toContain('.storyboard-gallery-hero');
  });

  it('does not keep the duplicate legacy artifact preview card in task detail', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).not.toContain('legacy-artifact-preview');
    expect(countOccurrences(main, '<ArtifactPreviewContent')).toBe(1);
  });

  it('auto-refreshes live task metrics without duplicating settings test controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('liveRefreshMs');
    expect(main).toContain('api.getState()');
    expect(main).toContain('liveNow');
    expect(main).toContain('testCurrentConfig');
    expect(main).toContain('保存并测试');
    expect(main).not.toContain('测试模型可用性');
    expect(css).toContain('.test-result');
  });

  it('shows save and test actions for each settings configuration section', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(viteEnv).toContain('testAppConfig');
    expect(preload).toContain('config:test');
    expect(electronMain).toContain('config:test');
    expect(main).toContain('testCurrentConfig');
    expect(main).toContain('保存并测试');
    expect(main).toContain('buildConfigForSelectedProfileTest');
    expect(main.indexOf('api.saveConfig(normalizeEditableConfigProviders(draft))')).toBeLessThan(main.indexOf('api.testAppConfig(target, testConfig)'));
    expect(main).toContain('selectedLlmProfileId');
    expect(main).toContain('selectedImageProfileId');
    expect(main).toContain('selectedTtsProfileId');
    expect(main).toContain('onSelectedProfileIdChange');
    expect(main).toContain('GPT Image Base URL');
    expect(main).toContain('GPT Image 模型');
    expect(main).toContain('自定义 API Key');
    expect(main).toContain('自定义模型');
    expect(main).toContain('即梦 AccessKey ID');
    expect(main).toContain('即梦 SecretAccessKey');
    expect(main).toContain('即梦 Req Key');
    expect(main).toContain('MiniMax 模型');
    expect(main).toContain('MiniMax 音色 ID');
  });

  it('loads model lists from configured provider URLs before selecting a model', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(preload).toContain('listProviderModels');
    expect(electronMain).toContain('models:list');
    expect(main).toContain('ModelPicker');
    expect(main).toContain('LlmProfileManager');
    expect(main).toContain('refreshProviderModels');
    expect(main).toContain('clearProviderModels');
    expect(main).toContain('listProviderModels');
    expect(main).toContain('获取模型');
    expect(main).toContain('key={`llm-${selectedProfile.id}`}');
    expect(main).toContain('key={`gpt-image-${selectedProfile.id}`}');
    expect(main).toContain('key={`custom-image-${selectedProfile.id}`}');
    expect(main).toContain("clearProviderModels('llm')");
    expect(main).toContain("onClearModels('gpt-image')");
    expect(main).toContain("onClearModels('custom-image')");
    expect(css).toContain('.model-picker');
    expect(css).toContain('.model-list-status');
  });

  it('keeps unsaved settings edits when app state refreshes in the background', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('settingsDirty');
    expect(main).toContain('setSettingsDraft');
    expect(main).toContain('commitSettingsDraft');
    expect(main).toContain('lastAppliedConfigSignature');
    expect(main).toContain('if (settingsDirty) return');
  });

  it('manages multiple LLM configuration profiles from a switcher-style list', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('LlmProfileManager');
    expect(main).toContain('activateLlmProfile');
    expect(main).toContain('activeLlmProfileId');
    expect(main).toContain('enableLlmProfile');
    expect(main).toContain('addLlmProfile');
    expect(main).toContain('copyLlmProfile');
    expect(main).toContain('removeLlmProfile');
    expect(main).toContain('新增配置');
    expect(main).toContain('启用');
    expect(main).toContain('data-profile-card');
    expect(css).toContain('.profile-switcher-list');
    expect(css).toContain('.provider-profile-card');
    expect(css).toContain('.provider-profile-card.active');
  });

  it('manages image and TTS providers with the same profile activation pattern', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('ImageProfileManager');
    expect(main).toContain('TtsProfileManager');
    expect(main).toContain('activateImageProfile');
    expect(main).toContain('activateTtsProfile');
    expect(main).toContain('activeImageProfileId');
    expect(main).toContain('activeTtsProfileId');
    expect(main).toContain('enableImageProfile');
    expect(main).toContain('enableTtsProfile');
    expect(main).toContain('commitAndApplySettingsDraft');
  });

  it('scopes provider-specific settings instead of showing every credential at once', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    for (const branch of [
      "selectedProvider === 'openai'",
      'OpenAI-compatible LLM',
      "provider === 'gpt_image'",
      "provider === 'jimeng'",
      "provider === 'custom'",
      "provider === 'volcengine'",
      "provider === 'minimax'",
    ]) {
      expect(main).toContain(branch);
    }
    expect(main).toContain("options={['openai', 'custom']}");
    expect(main).toContain("options={['gpt_image', 'jimeng', 'custom']}");
    expect(main).toContain("options={['volcengine', 'minimax']}");
    expect(main).toContain('normalizeEditableConfigProviders');
    expect(main).not.toContain("options={['gpt_image', 'jimeng', 'custom', 'mock']}");
    expect(main).not.toContain("options={['volcengine', 'minimax', 'mock']}");
    expect(main).not.toContain("draft.imageProvider === 'mock'");
    expect(main).not.toContain("draft.tts.provider === 'mock'");
    expect(main).not.toContain('即梦 SESSION ID');
    expect(main).not.toContain('代理 URL');
    expect(main).toContain('activeImageResolution');
    expect(main).toContain('setImageResolution');
    expect(main).toContain('ProviderConfigNote');
  });

  it('exposes Volcengine V3 API key settings and voice presets', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('volcengineVoicePresets');
    expect(main).toContain('listVolcengineSpeakers');
    expect(main).toContain('加载全部音色');
    expect(main).toContain('AccessKey ID（音色列表）');
    expect(main).toContain('SecretAccessKey（音色列表）');
    expect(main).toContain('火山 API Key');
    expect(main).toContain('Resource ID');
    expect(main).toContain('V3 HTTP Chunked');
    expect(main).toContain('volcenginePresetVoiceValue');
    expect(main).toContain('默认音色');
    expect(main).toContain('自定义 voice_type');
    expect(main).toContain('voice_type');
    expect(main).toContain('zh_female_vv_uranus_bigtts');
  });

  it('keeps task errors compact with a click-through detail dialog', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('ErrorSummaryButton');
    expect(main).toContain('ErrorDetailDialog');
    expect(main).toContain('summarizeErrorMessage');
    expect(main).toContain('fullMessage');
    expect(main).not.toContain('<small className="danger-text">{task.errorMessage}</small>');
    expect(main).not.toContain("stepEvent?.detail ?? statusLabelForStep(status)");
    expect(css).toContain('.error-summary-button');
    expect(css).toContain('.error-dialog');
  });

  it('lets AI creation search real web sources and select them for generation', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('searchWebSources');
    expect(main).toContain('composeResearchCopy');
    expect(main).toContain('Bing + 搜狗 + 百度 + 360');
    expect(main).toContain('selectedSearchSourceIds');
    expect(main).toContain('selectedSources');
    expect(main).toContain('ai-search-results');
    expect(main).toContain('ai-search-results-scroll');
    expect(main).toContain('ai-search-actions');
    expect(main).toContain("setMode('paste')");
    expect(main).toContain('setInputText(result.copy)');
    expect(main).toContain('setTitle(result.title');
    expect(main).toContain('结合所选页面信息生成文案');
    expect(main).toContain('网页候选（前 10 条）');
    expect(css).toContain('.ai-search-results');
    expect(css).toContain('.ai-search-results-scroll');
    expect(css).toContain('.ai-search-actions');
    expect(css).toContain('.extra-requirements-input');
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('.search-source-card');
  });

  it('runs image lab requests through real generation and renders returned image records', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('api.generateImageLab');
    expect(main).not.toContain("status: state.config.image.apiKey ? 'generated' : 'mock'");
    expect(main).not.toContain('预计消耗：本地模拟');
    expect(main).toContain('record.imagePath ?');
    expect(main).toContain("record.status === 'failed'");
    expect(css).toContain('.image-record img');
    expect(css).toContain('.image-record.failed');
  });

  it('reuses the React root across Vite hot reloads', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('__storyboundReactRoot');
    expect(main).toContain('window.__storyboundReactRoot ??=');
    expect(main).not.toContain("createRoot(document.getElementById('root')!).render(<App />)");
  });

  it('blocks real task execution in browser preview mode and avoids fake running states', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('isBrowserPreview');
    expect(main).toContain('浏览器预览不能执行真实流水线');
    expect(main).toContain('disabled={isBrowserPreview');
    expect(main).toContain('resumeTask');
    expect(main).not.toContain("task.status === 'paused' ? 'running' : 'paused'");
  });

  it('shows live image thumbnails with concurrency context and per-scene regeneration controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('readAssetDataUrl');
    expect(preload).toContain('regenerateTaskImage');
    expect(main).toContain('ImageGenerationGallery');
    expect(main).toContain('readAssetDataUrl');
    expect(main).toContain('regenerateTaskImage');
    expect(main).toContain('activeImageConcurrency');
    expect(main).toContain('imagePreviewUrls');
    expect(main).toContain('disabled={isBrowserPreview || task.status === \'running\'');
    expect(main).toContain('重新生成');
    expect(css).toContain('.image-preview-grid');
    expect(css).toContain('.image-preview-card');
    expect(css).toContain('.image-thumb');
  });

  it('shows playable narration previews with per-scene regeneration controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('regenerateTaskNarration');
    expect(main).toContain('NarrationPreviewList');
    expect(main).toContain('<audio controls');
    expect(main).toContain('audioPreviewUrls');
    expect(main).toContain('regenerateTaskNarration');
    expect(main).toContain('重新生成配音');
    expect(css).toContain('.narration-preview-list');
    expect(css).toContain('.narration-preview-card');
    expect(css).toContain('.narration-player');
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
