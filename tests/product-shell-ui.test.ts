import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('product shell ui', () => {
  it('presents a Chinese Storybound-first desktop shell with main workflow and secondary modules', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of [
      '主线工作流',
      '扩展工具',
      '最近任务',
      '试用剩余',
      '激活管理',
      '账户中心',
      '积分明细',
      '新建任务',
      '任务队列',
      '历史任务',
      '画图实验室',
      '配音实验室',
      '音乐 MV',
      '提示词模板',
      '草稿模板',
      '系统设置',
      '爆款拆解',
    ]) {
      expect(main).toContain(text);
    }

    expect(main).toContain('primaryNavItems');
    expect(main).toContain('secondaryNavItems');
    expect(main.indexOf('主线工作流')).toBeLessThan(main.indexOf('扩展工具'));
    expect(main.indexOf('新建任务')).toBeLessThan(main.indexOf('爆款拆解'));
    expect(main).toContain('className="trial-activation-bar"');
    expect(main).toContain('className="recent-task-strip"');
    expect(main).toContain('navigate(\'account\')');
    expect(main).toContain('navigate(\'activation\')');
    expect(css).toContain('.trial-activation-bar');
    expect(css).toContain('.recent-task-strip');
    expect(css).toContain('.nav-section-label');
    expect(css).toContain('.account-entry-grid');
  });

  it('keeps the viral analyzer visible in the main workflow navigation', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const primaryStart = main.indexOf('const primaryNavItems');
    const primaryEnd = main.indexOf('const secondaryNavItems');
    const secondaryEnd = main.indexOf('const navItems');
    const primaryNav = main.slice(primaryStart, primaryEnd);
    const secondaryNav = main.slice(primaryEnd, secondaryEnd);

    expect(primaryNav).toContain("view: 'viral-analyzer'");
    expect(primaryNav).toContain("label: '爆款拆解'");
    expect(secondaryNav).not.toContain("view: 'viral-analyzer'");
    expect(primaryNav.indexOf("view: 'music-mv'")).toBeLessThan(primaryNav.indexOf("view: 'viral-analyzer'"));
    expect(primaryNav.indexOf("view: 'viral-analyzer'")).toBeLessThan(primaryNav.indexOf("view: 'prompt-templates'"));
  });

  it('keeps sidebar navigation compact with stable two-line rows', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('grid-template-columns: 18px minmax(0, 1fr);');
    expect(css).toContain('grid-template-rows: 14px 11px;');
    expect(css).toContain('min-height: 34px;');
    expect(css).toContain('gap: 0 10px;');
    expect(css).toContain('.nav-item > svg');
    expect(css).toContain('grid-row: 1 / span 2;');
    expect(css).toContain('.nav-item span,');
    expect(css).toContain('text-overflow: ellipsis;');
    expect(css).toContain('white-space: nowrap;');
    expect(css).toContain('line-height: 14px;');
    expect(css).toContain('line-height: 11px;');
  });

  it('shows the whole sidebar menu and lets the lower task area shrink instead', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const navListBlock = css.match(/\.nav-list\s*\{[^}]+\}/)?.[0] ?? '';
    const sidebarBottomBlock = css.match(/\.sidebar-bottom\s*\{[^}]+\}/)?.[0] ?? '';
    const recentTaskBlock = css.match(/\.recent-task-strip\s*\{[^}]+\}/)?.[0] ?? '';

    expect(navListBlock).toContain('flex: 0 0 auto;');
    expect(navListBlock).toContain('overflow: visible;');
    expect(navListBlock).not.toContain('overflow: auto;');
    expect(sidebarBottomBlock).toContain('flex: 1 1 130px;');
    expect(sidebarBottomBlock).toContain('min-height: 130px;');
    expect(sidebarBottomBlock).toContain('overflow: hidden;');
    expect(sidebarBottomBlock).toContain('grid-template-rows: minmax(0, 1fr) auto auto;');
    expect(recentTaskBlock).toContain('min-height: 0;');
    expect(recentTaskBlock).toContain('overflow: auto;');
    expect(css).toContain('@media (max-height: 760px)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('flex-basis: 88px;');
    expect(css).toContain('min-height: 88px;');
  });

  it('uses a restrained storyboard-console visual system instead of a generic neon shell', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const token of ['--cyanprint', '--paper-warm', '--timeline-blue', '--surface-ink', '--shadow', '--focus-ring']) {
      expect(css).toContain(token);
    }

    expect(css).toContain('.app-shell::before');
    expect(css).toContain('repeating-linear-gradient(90deg');
    expect(css).toContain('.nav-item.active::before');
    expect(css).toContain('.page-head::before');
    expect(css).toContain('.primary-action:hover');
    expect(css).not.toContain('--accent: #12d4a0');
  });

  it('keeps browser preview fallback errors in Chinese', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).not.toContain('Browser preview cannot');
    expect(main).not.toContain('API key is missing; fill it before testing the model.');
    expect(main).not.toContain('Fallback Jianying effect catalog.');
    expect(main).not.toContain('Viral analysis result is not available in browser preview');
    expect(main).not.toContain('Viral recreation is not available in browser preview');
    expect(main).not.toContain('Python runtime dependency missing');
    expect(main).toContain('浏览器预览无法运行真实供应商流水线');
    expect(main).toContain('浏览器预览无法运行爆款视频拆解');
  });

  it('keeps all visible Storybound pipeline labels in Chinese', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    for (const text of [
      'Step 0 预审',
      'Step 1 三轮改写自评',
      'Step 2 分镜',
      'Step 3 主角档案与出图提示词',
      'Step 4 批量生图',
      'Step 5 配音',
      'Step 6 草稿导出',
      '暂停后可续跑',
      '重新生成',
      '改写后继续',
      '草稿输出',
    ]) {
      expect(main).toContain(text);
    }
  });

  it('defines the complete Storybound-style navigation shell', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const view of ['new-task', 'queue', 'history', 'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'prompt-templates', 'draft-templates', 'settings', 'account', 'activation']) {
      expect(main).toContain(view);
    }
    for (const text of ['新建任务', '任务队列', '历史任务', '画图实验室', '音乐MV', '提示词模板', '草稿模板', '系统设置']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.app-shell');
    expect(css).toContain('--accent');
  });

  it('adds a standalone voice lab for provider voice previews and history playback', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'VoiceLabPage',
      'api.generateVoiceLabPreview',
      'voiceLabRecords',
      'voice-lab-layout',
      'voice-lab-text',
      'voice-lab-voices',
      'voice-lab-player',
      'voice-lab-history',
      'voiceProvider',
      'voiceSpeed',
      'ttsVoiceOptionsForProvider',
      'taskSpeakerLabel',
    ]) {
      expect(main).toContain(symbol);
    }

    expect(preload).toContain('generateVoiceLabPreview');
    expect(css).toContain('.voice-lab-layout');
    expect(css).toContain('.voice-lab-voices');
    expect(css).toContain('.voice-record');
    expect(css).toContain('.voice-lab-player');
  });

  it('adds a complete music MV page and sends MV task settings into task creation', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');

    for (const symbol of [
      "'music-mv'",
      'MusicMvPage',
      'music-mv-layout',
      'musicMvRhythmMode',
      'musicMvCaptionStyle',
      'musicMvVisualMotif',
      'musicMvAudioPath',
      "taskKind: 'music-mv'",
      'processingMode',
      'setProcessingMode',
      'musicMv:',
    ]) {
      expect(main).toContain(symbol);
    }

    expect(types).toContain("export type ProcessingMode = 'full-auto' | 'semi-auto' | 'clip-only'");
    expect(types).toContain("export type TaskKind = 'story' | 'music-mv'");
    expect(css).toContain('.music-mv-layout');
    expect(css).toContain('.music-mv-preview');
  });

  it('wires the viral analyzer page into the shell with report and recreation controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'ViralAnalyzerPage',
      'createAndRunViralAnalysis',
      'createProductionTaskFromViral',
      'viral-analyzer-layout',
      'viral-url-input',
      'viral-platform-picker',
      'viral-workbench',
      'viral-progress-list',
      'viral-stage-timeline',
      'viral-stage-node',
      'viral-result-drawer',
      'viral-insight-tabs',
      'viral-frame-insights',
      'viral-copy-breakdown',
      'viral-original-copy',
      'viral-insight-card',
      'viral-report-grid',
      'viral-recreation-panel',
      'viral-create-production-task',
    ]) {
      expect(main).toContain(symbol);
    }

    for (const text of ['爆款拆解', '开头', '结构', '结尾', '爆点', '文案拆解', '原文案', '提示词拆解', '一键复刻成片任务']) {
      expect(main).toContain(text);
    }
    expect(main).not.toContain('特效拆解');
    expect(main).not.toContain("type ViralInsightTab = 'prompt' | 'effects'");
    expect(main).toContain('latestViralEventForStage');
    expect(main).not.toContain('selectedEvents.find((event) => event.stage === stage)');

    const viralReport = main.slice(main.indexOf('function ViralReport'), main.indexOf('function viralTranscriptText'));
    expect(viralReport).toContain('uniqueViralPromptFrames(result.frames)');
    expect(viralReport).not.toContain('slice(0, 8)');
    expect(viralReport).toContain('关键帧数量');
    expect(viralReport).toContain('keyFrameCount');

    expect(css).toContain('.viral-analyzer-layout');
    expect(css).toContain('.viral-workbench');
    expect(css).toContain('@media (max-width: 1380px)');
    expect(css).toContain('max-height: min(560px, calc(100vh - 240px))');
    expect(css).toContain('.viral-input-panel');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('.viral-stage-timeline');
    expect(css).toContain('.viral-stage-node');
    expect(css).toContain('.viral-result-drawer');
    expect(css).toContain('.viral-insight-tabs');
    expect(css).toContain('.viral-frame-insights');
    expect(css).toContain('.viral-insight-card');
    expect(css).toContain('.viral-history-item strong');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain('.viral-report-grid');
    expect(css).toContain('.viral-recreation-panel');
    expect(css).toContain('.viral-report-card strong');
    expect(css).toContain('.viral-report-card p');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toMatch(/\.viral-report-card\s*\{[\s\S]*?gap: 6px;[\s\S]*?min-height: 128px;[\s\S]*?padding: 12px;/);
    expect(css).toMatch(/\.viral-report-card strong\s*\{[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?font-size: 15px;[\s\S]*?line-height: 1\.28;/);
    expect(css).toMatch(/\.viral-report-card p\s*\{[\s\S]*?-webkit-line-clamp: 3;/);
  });

  it('keeps viral source detection independent from manual platform selection and avoids native select popups', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const page = main.slice(main.indexOf('function ViralAnalyzerPage'), main.indexOf('const viralStages'));
    const platformSnippet = page.slice(page.indexOf('className="segmented viral-platform-picker"'), page.indexOf('<p className="viral-source-status">'));

    expect(page).toContain('sourceMode');
    expect(page).toContain('selectedPlatformForAnalysis');
    expect(main).toContain('viral-choice-grid');
    expect(platformSnippet).not.toContain('<select');
    expect(css).toContain('.viral-source-status');
    expect(css).toContain('.viral-choice-button.active');
  });

  it('uses a compact dropdown for viral analyzer draft templates', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const page = main.slice(main.indexOf('function ViralAnalyzerPage'), main.indexOf('const viralStages'));

    expect(page).toContain('<Field label="草稿模板">');
    expect(page).toContain('className="viral-draft-template-select"');
    expect(page).toContain('value={templateId}');
    expect(page).toContain('onChange={(event) => setTemplateId(event.target.value)}');
    expect(page).toContain('state.draftTemplates.map((template) => (');
    expect(page).toContain('<option key={template.id} value={template.id}>');
    expect(page).not.toContain('ViralChoiceGroup title="草稿模板"');
    expect(css).toContain('.viral-draft-template-select');
  });

  it('surfaces Douyin login and cookie file controls in the viral analyzer', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const page = main.slice(main.indexOf('function ViralAnalyzerPage'), main.indexOf('const viralStages'));

    expect(page).toContain('api.openViralLoginWindow');
    expect(page).toContain('api.selectCookieFile');
    expect(page).toContain('const loginCookiePath = await api.openViralLoginWindow();');
    expect(page).toContain('setCookieFilePath(loginCookiePath);');
    expect(page).toContain('已保存 Cookie 文件');
    expect(page).toContain('viral-cookie-tools');
    expect(page).toContain('viral-cookie-input-row');
    expect(page).toContain('打开抖音登录窗口');
    expect(page).toContain('选择 Cookie 文件');
    expect(page).toContain('Cookie 文件');
    expect(css).toContain('.viral-cookie-tools');
    expect(css).toContain('.viral-cookie-input-row');
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

  it('imports copied Coze workflow source as a draft template preset', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const toolbarSnippet = main.slice(main.indexOf('className="panel-title-row draft-template-toolbar"'), main.indexOf('<section className="draft-template-gallery">'));

    expect(main).toContain('convertCozeWorkflowToDraftTemplate');
    expect(main).toContain('convertManyCozeWorkflowsToDraftTemplates');
    expect(main).toContain('cozeImportOpen');
    expect(main).toContain('setCozeImportOpen(true)');
    expect(main).toContain('setCozeImportOpen(false)');
    expect(main).toContain('cozeWorkflowSource');
    expect(main).toContain('cozeImportResult');
    expect(main).toContain('cozeImportResults');
    expect(main).toContain('previewCozeWorkflowTemplate');
    expect(main).toContain('saveCozeWorkflowTemplate');
    expect(main).toContain('saveAllCozeWorkflowTemplates');
    expect(toolbarSnippet).toContain('导入 Coze 模板');
    expect(toolbarSnippet).toContain('role="dialog"');
    expect(toolbarSnippet).toContain('aria-modal="true"');
    expect(toolbarSnippet).toContain('coze-template-import-backdrop');
    expect(toolbarSnippet).toContain('coze-template-import-dialog');
    expect(toolbarSnippet).toContain('onClick={() => setCozeImportOpen(false)}');
    expect(main).toContain('coze-workflow-source');
    expect(main).toContain('api.saveDraftTemplate(template)');
    expect(main).not.toContain('<section className="panel coze-template-import-panel">');
    expect(css).toContain('.coze-template-import-backdrop');
    expect(css).toContain('.coze-template-import-dialog');
    expect(css).toContain('.coze-template-import-panel');
    expect(css).toContain('.coze-diagnostics-list');
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

  it('renders draft preview layers with visibility and style fields', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('template.image.visible ?');
    expect(main).toContain('draftTextLayerStyle(template.title');
    expect(main).toContain('template.title.bold ? 800 : 500');
    expect(main).toContain('template.subtitle.text');
    expect(main).toContain('template.caption.alpha');
    expect(main).toContain('template.caption.underline');
    expect(main).toContain('draftTextLayerStyle(template.subtitle');
    expect(main).toContain('draftTextLayerStyle(template.disclaimer');
    expect(main).toContain('template.disclaimer.fontSize');
    expect(main).toContain('opacity: text.alpha');
    expect(main).toContain("textDecoration: text.underline ? 'underline' : 'none'");
    expect(main).toContain('textAlign: draftTextAlign(text.align)');
    expect(main).toContain('letterSpacing: `${text.letterSpacing}px`');
    expect(main).toContain('lineHeight: `${1 + text.lineSpacing / 10}`');
    expect(main).toContain('draftTextAlign');
    expect(main).toContain('colorWithAlpha');
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

  it('exposes complete grouped controls for draft template layers', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('ColorField');
    expect(main).toContain('ToggleField');
    expect(main).toContain('RangeField');
    expect(main).toContain('updateDraftTitle');
    expect(main).toContain('updateDraftSubtitle');
    expect(main).toContain('updateDraftCaption');
    expect(main).toContain('updateDraftCaptionBackground');
    expect(main).toContain('updateDraftDisclaimer');
    expect(main).toContain('显示');
    expect(main).toContain('透明度');
    expect(main).toContain('加粗');
    expect(main).toContain('下划线');
    expect(main).toContain('对齐');
    expect(main).toContain('字间距');
    expect(main).toContain('行间距');
    expect(main).toContain('每行字数');
    expect(main).toContain('背景透明度');
    expect(main).toContain('圆角');
    expect(css).toContain('.draft-color-field');
    expect(css).toContain('.draft-range-field');
    expect(css).toContain('.draft-toggle-field');
  });

  it('exposes text border controls and preview stroke for draft text layers', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'TextBorderControls',
      'updateDraftTitleBorder',
      'updateDraftSubtitleBorder',
      'updateDraftCaptionBorder',
      'updateDraftDisclaimerBorder',
      'draftTextBorderStyle',
      'template.title.border',
      'template.subtitle.border',
      'template.caption.border',
      'template.disclaimer.border',
      'textShadow',
    ]) {
      expect(main).toContain(symbol);
    }

    for (const text of ['描边颜色', '描边宽度', '描边透明度']) {
      expect(main).toContain(text);
    }

    expect(css).toContain('.draft-border-controls');
  });

  it('exposes Storybound text style controls for every draft text layer', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    for (const symbol of [
      'updateDraftTitle({ underline: checked })',
      'updateDraftTitle({ align: Number(event.target.value) })',
      'updateDraftTitle({ letterSpacing: value })',
      'updateDraftTitle({ lineSpacing: value })',
      'updateDraftSubtitle({ underline: checked })',
      'updateDraftSubtitle({ align: Number(event.target.value) })',
      'updateDraftSubtitle({ letterSpacing: value })',
      'updateDraftSubtitle({ lineSpacing: value })',
      'updateDraftDisclaimer({ bold: checked })',
      'updateDraftDisclaimer({ underline: checked })',
      'updateDraftDisclaimer({ align: Number(event.target.value) })',
      'updateDraftDisclaimer({ letterSpacing: value })',
      'updateDraftDisclaimer({ lineSpacing: value })',
      'draftTextLayerStyle(template.title',
      'draftTextLayerStyle(template.subtitle',
      'draftTextLayerStyle(template.disclaimer',
      'text.underline',
      'text.align',
      'text.letterSpacing',
      'text.lineSpacing',
    ]) {
      expect(main).toContain(symbol);
    }
  });

  it('keeps draft layer controls compact instead of rendering oversized checkbox cards', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main.includes('className="draft-toggle-row"')).toBe(true);
    expect(main.includes('draft-toggle-control')).toBe(true);
    expect(main.includes('className="draft-toggle-box"')).toBe(true);
    expect(main.includes('className="draft-inline-border-grid"')).toBe(true);
    expect(main.includes('className="draft-border-compact-panel"')).toBe(false);
    expect(main.indexOf('onChange={updateDraftTitleBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftTitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftTitleBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftSubtitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftSubtitleBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftSubtitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftSubtitleBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftCaption({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftCaptionBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftCaption({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftCaptionBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftDisclaimer({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftDisclaimerBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftDisclaimer({ visible: checked })}'));
    expect(main.includes('<Accordion title="文字描边">')).toBe(false);
    expect(css.includes("input[type='checkbox']")).toBe(true);
    expect(css.includes('width: 16px')).toBe(true);
    expect(css.includes('.draft-toggle-row')).toBe(true);
    expect(css.includes('.draft-toggle-control')).toBe(true);
    expect(css.includes('.draft-toggle-box')).toBe(true);
    expect(css.includes('.draft-border-compact-panel')).toBe(false);
    expect(css.includes('.draft-inline-border-grid')).toBe(true);
    expect(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))')).toBe(true);
  });

  it('keeps the draft canvas visible while the right controls scroll independently', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.draft-editor-shell.focused');
    expect(css).toContain('align-items: start');
    expect(css).toContain('.draft-stage {');
    expect(css).toContain('position: sticky');
    expect(css).toContain('top: 0');
    expect(css).toContain('.draft-controls {');
    expect(css).toContain('max-height: calc(100vh - 150px)');
    expect(css).toContain('max-height: min(calc(100vh - 150px), calc(100vh - 220px))');
    expect(css).toContain('overflow-y: auto');
  });

  it('sizes the focused draft preview to the available viewport height', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain("'--draft-canvas-ratio'");
    expect(css).toContain('.draft-editor-shell.focused .draft-preview-large');
    expect(css).toContain('calc((100vh - 310px) * var(--draft-canvas-ratio');
  });

  it('uses a preview-safe text stroke instead of rendering Storybound 40px borders as giant shadows', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('draftTextStrokeStyle');
    expect(main).toContain('WebkitTextStroke');
    expect(main).toContain('previewStrokeWidth');
    expect(main).not.toContain('for (let x = -width; x <= width; x += width)');
    expect(css).toContain('.draft-title,');
    expect(css).toContain('white-space: pre-line');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('line-height: 1.15');
  });

  it('lets draft template text boxes be resized instead of using a fixed 80 percent width', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('resizeDraftLayerWidth');
    expect(main).toContain('handleDraftCanvasResizePointerDown');
    expect(main).toContain('onResizePointerDown');
    expect(main).toContain('draftTextWidthStyle');
    expect(main).toContain('label="文本框宽度"');
    expect(main).toContain('updateDraftCaptionWidth');
    expect(main).toContain('const DRAFT_TEXT_WIDTH_MAX = 2');
    expect(main).toContain('max={DRAFT_TEXT_WIDTH_MAX}');
    expect(main).toContain('width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`');
    expect(main).toContain('positioned={false}');
    for (const snippet of [
      'value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
      'value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
      'value={draft.caption.width} onChange={updateDraftCaptionWidth}',
      'value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
    ]) {
      expect(main).toContain(snippet);
    }
    expect(main.indexOf('value={draft.title.width}')).toBeLessThan(main.indexOf('value={draft.title.fontSize}'));
    expect(main.indexOf('value={draft.subtitle.width}')).toBeLessThan(main.indexOf('value={draft.subtitle.fontSize}'));
    expect(main.indexOf('value={draft.caption.width}')).toBeLessThan(main.indexOf('value={draft.caption.fontSize}'));
    expect(main.indexOf('value={draft.disclaimer.width}')).toBeLessThan(main.indexOf('value={draft.disclaimer.fontSize}'));
    expect(css).toContain('cursor: ew-resize');
    expect(css).not.toContain('width: 80%;');
  });

  it('shows the full learned Jianying animation list in draft template controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const templates = await readFile(new URL('../src/shared/templates.ts', import.meta.url), 'utf8');

    expect(main).toContain('options={imageAnimations}');
    expect(main).not.toContain('imageAnimations.slice(0, 8)');
    for (const animation of ['左拉镜', '右拉镜', '弹入旋转', '旋转回吸', '滑滑梯 II', '百叶窗 II', '立方体', '海盗船']) {
      expect(templates).toContain(animation);
    }
  });

  it('wires uploaded BGM management into settings and new task defaults', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('selectLocalAudio');
    expect(main).toContain('addUploadedBgm');
    expect(main).toContain('resolveDefaultBgmId');
    expect(main).toContain('defaultBgmId');
    expect(main).toContain('无 BGM');
    expect(main).toContain('BGM 库为空');
    expect(main).toContain('volume: 0.25');
    expect(main).toContain('bgm-library-list');
    expect(css).toContain('.bgm-library-list');
    expect(css).toContain('.bgm-library-item');
  });

  it('offers auto-detect and folder-pick actions for the Jianying draft path setting', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('detectJianyingDraftPath');
    expect(main).toContain('selectLocalFolder');
    expect(main).toContain('autoDetectJianyingDraftPath');
    expect(main).toContain('pickJianyingDraftPath');
    expect(main).toContain('自动检测');
    expect(main).toContain('选择目录');
  });

  it('loads Jianying effect catalogs and exposes conservative draft effect controls', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('getJianyingEffectCatalog');
    expect(main).toContain('effectCatalog');
    expect(main).toContain('transitionType');
    expect(main).toContain('transitionDurationMs');
    expect(main).toContain('narrationFadeInMs');
    expect(main).toContain('narrationFadeOutMs');
    expect(main).toContain('bgmFadeInMs');
    expect(main).toContain('filterType');
    expect(main).toContain('videoEffectType');
    expect(main).toContain('audioEffectType');
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

  it('manages prompt templates with filters, metadata, variables, and save-as-new-template behavior', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'createPromptTemplate',
      'exportPromptTemplateJson',
      'templateTypeFilter',
      'templateTrackFilter',
      'templateMode',
      'prompt-template-gallery',
      'prompt-template-detail',
      'openPromptTemplateDetail',
      'savePromptTemplateDraft',
      'promptTemplateVariables',
    ]) {
      expect(main).toContain(symbol);
    }
    for (const text of ['新建模板', '导出 JSON', '类型筛选', '赛道筛选', '变量', '每次保存都会新增一个独立模板页', '返回模板库', '查看']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.template-filter-row');
    expect(css).toContain('.variable-chip-row');
    expect(css).toContain('.prompt-template-gallery');
    expect(css).toContain('.prompt-template-detail');
  });

  it('builds prompt template track filters from saved templates so custom tracks remain visible', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const filterSnippet = main.slice(main.indexOf('<Field label="赛道筛选">'), main.indexOf('<section className="prompt-template-list story-template-gallery">'));

    expect(main).toContain('promptTemplateTrackOptions');
    expect(main).toContain('buildStoryTemplateTrackOptions(state.promptTemplates)');
    expect(filterSnippet).toContain('promptTemplateTrackOptions.map(([id, label])');
    expect(filterSnippet).not.toContain('contentTracks.map');
  });

  it('saves every prompt template edit as an independent new template page', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const saveSnippet = main.slice(main.indexOf('async function savePromptTemplateDraft()'), main.indexOf('async function duplicateTemplate'));
    const duplicateSnippet = main.slice(main.indexOf('async function duplicateTemplate'), main.indexOf('async function duplicate()'));

    expect(saveSnippet).toContain('id: crypto.randomUUID()');
    expect(saveSnippet).toContain('isBuiltin: false');
    expect(saveSnippet).toContain("origin: 'custom'");
    expect(saveSnippet).not.toContain('draft.isBuiltin');
    expect(saveSnippet).not.toContain('baseTemplateId');
    expect(duplicateSnippet).not.toContain('baseTemplateId');
    expect(main).not.toContain('<Field label="baseTemplateId">');
  });

  it('uses saved template tracks when binding prompt templates to content tracks', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const bindingSnippet = main.slice(main.indexOf('<Field label="绑定赛道">'), main.indexOf('</Field>', main.indexOf('<Field label="绑定赛道">')));

    expect(main).toContain('promptTemplateBindingTrackOptions');
    expect(bindingSnippet).toContain('promptTemplateBindingTrackOptions.map(([id, label])');
    expect(bindingSnippet).not.toContain('contentTracks.map');
  });

  it('binds newly created prompt templates to the active track filter when present', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const createSnippet = main.slice(main.indexOf('async function createPromptTemplate()'), main.indexOf('async function saveCustomStyleDraft()'));

    expect(createSnippet).toContain("const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter");
    expect(createSnippet).toContain('baseTrack,');
    expect(createSnippet).not.toContain("baseTrack: 'general-story'");
  });

  it('keeps prompt template pages padded, scrollable, and tolerant of narrow row actions', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    const scrollablePageRule = css.match(/\.new-task-scroll,[\s\S]*?\.lab-layout\s*\{[\s\S]*?overflow: auto;[\s\S]*?padding: 20px 26px;[\s\S]*?\}/)?.[0] ?? '';
    expect(scrollablePageRule).toContain('.prompt-template-gallery');
    expect(scrollablePageRule).toContain('.prompt-template-detail');
    expect(css).toMatch(/\.prompt-template-row-actions\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?\}/);
  });

  it('opens prompt template details from the whole row without hijacking row action buttons', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('handlePromptTemplateRowKeyDown');
    expect(main).toContain('role="button"');
    expect(main).toContain('tabIndex={0}');
    expect(main).toContain('onClick={() => openPromptTemplateDetail(template)}');
    expect(main).toContain('event.stopPropagation()');
    expect(css).toMatch(/\.prompt-template-row\s*\{[\s\S]*?cursor: pointer;[\s\S]*?\}/);
  });

  it('lets each task prompt template configure the AI prompts used by every pipeline step', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of ['promptStepEditorDefinitions', 'updatePromptTemplateStepPrompt', 'stepPrompts', 'prompt-step-editor-list', 'prompt-step-editor-card']) {
      expect(main).toContain(symbol);
    }
    for (const text of ['AI 步骤设置', 'Step 0 预审', 'Step 1 改写', 'Step 1 元数据', 'Step 2 分镜', 'Step 3 出图']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.prompt-step-editor-list');
    expect(css).toContain('.prompt-step-editor-card');
  });

  it('keeps prompt editing to a single content entry while preserving image seed pools', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const storage = await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'imageSeedPoolsJson',
      'prompt-template-seed-pools',
    ]) {
      expect(main).toContain(symbol);
    }

    expect(main).not.toContain('prompt-template-reference-fields');
    expect(main).not.toContain('参考提示词内容');
    expect(main).not.toContain("draft.type === 'task' ? '任务总指令'");
    expect(main).toContain('key="task-template-content"');

    expect(storage).toContain('imageSeedPoolsJson');
  });

  it('presents prompt template details as basics, content settings, and step default prompts', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'prompt-template-basics-card',
      'prompt-template-default-style-pills',
      'prompt-template-settings-card',
      'prompt-template-content-settings',
      'prompt-step-editor-section-title',
    ]) {
      expect(main).toContain(symbol);
      expect(css).toContain(`.${symbol}`);
    }

    for (const text of ['模板名', '描述（一句话说明这个模板的特点）', '默认画风', '设置内容', '步骤默认提示词']) {
      expect(main).toContain(text);
    }
  });

  it('uses Chinese labels for prompt template types and variable insertion chips', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('promptTemplateTypeLabels');
    expect(main).toContain('promptTemplateTypeLabel(type)');
    expect(main).toContain('promptTemplateVariableDefinitions');
    expect(main).toContain('prompt-template-variable-chip');
    expect(css).toContain('.prompt-template-variable-chip');

    for (const text of ['任务模板', '预审提示词', '改写提示词', '出图提示词', '原文素材', '联网资料', '预审结果', '改写正文', '额外要求']) {
      expect(main).toContain(text);
    }
    expect(main).not.toContain('>{`{{${item}}}`}</button>');
  });

  it('splits prompt template management into story and image template tabs', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'promptTemplateLibraryTab',
      'story-template-gallery',
      'image-template-gallery',
      'openImageTemplateDetail',
      'saveCustomStyleDraft',
      'generateCustomStyleDraft',
      'imageTemplateAiPrompt',
      'baseImageTemplateId',
      'mergeDefaultCustomStyles',
    ]) {
      expect(main).toContain(symbol);
    }
    for (const text of ['故事模板', '图像模板', 'AI 快速生成', '基于系统风格', '前缀（prefix）', '后缀（suffix）', '负面提示词（negativePrompt）', '色彩模式']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.prompt-template-tabs');
    expect(css).toContain('.image-template-quick-card');
    expect(css).toContain('.image-template-field-grid');
  });

  it('shows visible feedback while generating image template fields', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'imageTemplateAiStatus',
      'imageTemplateAiGenerating',
      'image-template-ai-status',
      'aria-live="polite"',
      '正在生成字段',
      '已生成字段',
      '生成失败',
      '请先输入风格描述',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(main).toContain('disabled={imageTemplateAiGenerating}');
    expect(css).toContain('.image-template-ai-status');
  });

  it('keeps prompt variables usable inside every template textarea', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'VariableAwareTextarea',
      'insertPromptVariable',
      'prompt-variable-suggest',
      'onVariableInsert',
      'placeholder="输入 // 选择变量"',
      '{{${item.key}}',
      '英文变量',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(css).toContain('.prompt-variable-suggest');
    expect(css).toContain('.prompt-variable-token');
  });

  it('supports import, export, and clone for story and image templates without overwriting existing ids', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    for (const symbol of [
      'exportPromptTemplateJson',
      'importPromptTemplateJson',
      'exportImageTemplateJson',
      'importImageTemplateJson',
      'templateJsonDraft',
      'imageTemplateJsonDraft',
      'resolveImportedTemplateId',
      'duplicateTemplate',
      'duplicateImageTemplate',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(main).toContain('state.promptTemplates.some((template) => template.id === imported.id)');
    expect(main).toContain('state.customStyles.some((style) => style.id === imported.id)');
  });

  it('syncs all story template defaults when changing story templates in new task', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('handleStoryTemplateChange');
    expect(main).toContain('setTrack(nextTrack)');
    expect(main).toContain('setPromptTemplateOverrideId(nextTemplateId)');
    expect(main).toContain('promptTemplateManuallyOverridden');
    expect(main).toContain('styleManuallyOverridden');
    expect(main).toContain('draftTemplateManuallyOverridden');
    expect(main).toContain('resolvePromptTemplateDefaultStyleId');
    expect(main).toContain('resolvePromptTemplateDefaultDraftTemplateId');
    expect(main).toContain('handleDraftTemplateChange');
    expect(main).toContain('draftTemplateImageRatio');
    expect(main).toContain('模板默认项');
    expect(main).toContain('主角档案');
    expect(main).toContain('默认草稿模板');
    expect(main).toContain('参考图类型');
    expect(main).toContain('Step 3 骨架');
    expect(main).toContain('setRatio(draftTemplateImageRatio');
    expect(main).toContain('defaultStyles: [style.id]');
    expect(main).toContain('defaultDraftTemplateId');
    expect(main).not.toContain('toggleArray(resolvePromptTemplateDefaultStyleIds(draft), style.id)');
    expect(main).not.toContain('OptionCloud title="草稿模板" options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])} value={templateId} onChange={setTemplateId}');
  });

  it('moves bundled Coze draft templates into a separate fallback selector in new task', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('bundledDraftTemplateOptionIds');
    expect(main).toContain('isBundledDraftTemplateOption');
    expect(main).toContain('primaryDraftTemplates');
    expect(main).toContain('alternateDraftTemplates');
    expect(main).toContain('defaultTaskDraftTemplateId');
    expect(main).toContain('draft-template-picker-stack');
    expect(main).toContain('draft-template-alternate-select');
    expect(main).toContain('<option value="">选择备选模板</option>');
    expect(main).toContain('options={primaryDraftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])}');
    expect(main).not.toContain('options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])}');
    expect(main).not.toContain("const initialDraftTemplateId = state.draftTemplates[0]?.id ?? 'default-portrait-9-16'");
    expect(css).toContain('.draft-template-picker-stack');
    expect(css).toContain('.draft-template-alternate-select');
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

  it('shows per-step rerun controls in artifact preview sections', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('rerunTaskStep');
    expect(main).toContain('rerunTaskStep');
    expect(main).toContain('ArtifactStepActions');
    expect(main).toContain('重新生成');
    expect(main).toContain('改写后继续');
    expect(main).toContain('actions={artifactStepActions(1)}');
    expect(main).toContain('actions={artifactStepActions(6)}');
    expect(css).toContain('.artifact-section-actions');
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

  it('keeps the storyboard gallery tab focused on batch images and scene sentences', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    const storyboardStart = main.indexOf("{tab === 'storyboard' ? (");
    const audioStart = main.indexOf("{tab === 'audio' ? (", storyboardStart);
    const storyboardBranch = main.slice(storyboardStart, audioStart);
    const batchImagesIndex = storyboardBranch.indexOf('ArtifactSection title="批量生图"');
    const scenesIndex = storyboardBranch.indexOf('ArtifactSection title="分镜分句"', batchImagesIndex);

    expect(storyboardStart).toBeGreaterThan(-1);
    expect(audioStart).toBeGreaterThan(storyboardStart);
    expect(batchImagesIndex).toBeGreaterThan(-1);
    expect(scenesIndex).toBeGreaterThan(batchImagesIndex);
    expect(storyboardBranch).toContain('ImageGenerationGallery');
    expect(storyboardBranch).toContain('ArtifactSceneList');
    expect(storyboardBranch).not.toContain('storyboard-gallery-hero');
    expect(storyboardBranch).not.toContain('ArtifactSection title="全部图片"');
    expect(storyboardBranch).not.toContain('ArtifactSection title="绘图提示词"');
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
    expect(main).toContain('GPT Image 接口地址');
    expect(main).toContain('GPT Image 模型');
    expect(main).toContain('自定义接口密钥');
    expect(main).toContain('自定义模型');
    expect(main).toContain('即梦访问密钥 ID');
    expect(main).toContain('即梦访问密钥 Secret');
    expect(main).toContain('即梦请求 Key');
    expect(main).toContain('MiniMax 模型');
    expect(main).toContain('MiniMax 音色 ID');
  });

  it('adds speech-to-text API settings for viral analyzer transcription', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    for (const text of [
      '语音转文字',
      '转写 API',
      '接口地址',
      '接口密钥',
      '转写模型',
      '语言',
      '提示词',
      '响应格式',
      '温度',
      '时间戳',
      '段落级',
      '词级',
      '切分策略',
      '请求超时',
      'SiliconFlow',
      'FunAudioLLM/SenseVoiceSmall',
      'TeleAI/TeleSpeechASR',
    ]) {
      expect(main).toContain(text);
    }

    const settingsPage = main.slice(main.indexOf('function SettingsPage'), main.indexOf('function LlmProfileManager'));
    expect(settingsPage).toContain("configTargetStatus('speechToText', draft)");
    expect(settingsPage).toContain("section === 'speechToText'");
    expect(settingsPage).toContain('updateSpeechToTextConfig');

    const viralPage = main.slice(main.indexOf('function ViralAnalyzerPage'), main.indexOf('const viralStages'));
    expect(viralPage).not.toContain('whisperModel');
    expect(viralPage).not.toContain('huggingFaceEndpoint');
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
      'OpenAI 兼容 LLM',
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
    expect(main).toContain('音色列表访问密钥 ID');
    expect(main).toContain('音色列表访问密钥 Secret');
    expect(main).toContain('火山接口密钥');
    expect(main).toContain('资源 ID');
    expect(main).toContain('V3 HTTP Chunked');
    expect(main).toContain('volcenginePresetVoiceValue');
    expect(main).toContain('默认音色');
    expect(main).toContain('自定义 voice_type');
    expect(main).toContain('voice_type');
    expect(main).toContain('zh_female_vv_uranus_bigtts');
  });

  it('uses provider-specific task voice defaults in the new task form', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const voices = await readFile(new URL('../src/shared/tts-voices.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'ttsProvider',
      'setTtsProvider',
      'ttsVoiceOptionsForProvider',
      'defaultTaskSpeakerForProvider',
      'taskSpeakerLabel',
      "labels={['豆包', 'MiniMax']}",
      'zh_female_vv_uranus_bigtts',
      'male-qn-qingse',
    ]) {
      expect(main + voices).toContain(symbol);
    }
    expect(main).not.toContain("const voiceOptions = ['东方浩然', '灿博小叔', '温柔小雅', '爽快思思', '更多音色...'];");
    expect(main).not.toContain('>更多音色...</button>');
  });

  it('syncs new-task content and style choices from story and image templates', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

    expect(main).toContain('buildStoryTemplateTrackOptions');
    expect(main).toContain('buildStoryTemplateOptions');
    expect(main).toContain('buildTaskPromptTemplateOptions');
    expect(main).toContain('buildImageTemplateStyleOptions');
    expect(main).toContain('storyTemplateOptions');
    expect(main).toContain('taskPromptTemplateOptions');
    expect(main).toContain('imageTemplateStyleOptions');
    expect(main).toContain('options={storyTemplateOptions}');
    expect(main).toContain('value={selectedStoryTemplateId}');
    expect(main).toContain('handleStoryTemplateChange');
    expect(main).toContain('options={imageTemplateStyleOptions}');
    expect(main).toContain('buildTaskPromptTemplateOptions(state.promptTemplates, track)');
    expect(main).toContain('taskPromptTemplateOptions.map(([id, label, hint])');
    expect(main).toContain('value={promptTemplateOverrideId || resolvedPromptTemplate?.id || \'\'}');
    expect(main).not.toContain('OptionCloud title="内容赛道" options={contentTracks}');
    expect(main).not.toContain('OptionCloud title="画面风格" options={styleOptions}');
  });

  it('keeps task errors compact with a click-through detail dialog', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('ErrorSummaryButton');
    expect(main).toContain('ErrorDetailDialog');
    expect(main).toContain('summarizeErrorMessage');
    expect(main).toContain('Python 运行时缺少依赖');
    expect(main).toContain('Python 运行时依赖缺失');
    expect(main).toContain('className="mini-button viral-retry-button"');
    expect(main).toContain('fullMessage');
    expect(main).not.toContain('<small className="danger-text">{task.errorMessage}</small>');
    expect(main).not.toContain("stepEvent?.detail ?? statusLabelForStep(status)");
    expect(css).toContain('.error-summary-button');
    expect(css).toContain('.error-dialog');
    expect(css).toContain('.error-summary-button > span:last-child');
    expect(css).toContain('.viral-retry-button');
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
