export interface ApprovedInventory {
  values: readonly string[];
  owner: string;
  consumer: string;
  test: string;
}

function inventory(values: readonly string[], owner: string, consumer: string, test: string): ApprovedInventory {
  return { values, owner, consumer, test };
}

export const approvedEditorialInventories = {
  shellViews: inventory([
    'new-task', 'hot-board', 'queue', 'history', 'task-detail', 'editorial-collage', 'motion-comic', 'html-video',
    'image-lab', 'voice-lab', 'music-mv',
    'book-selection', 'benchmark', 'person-assets', 'viral-analyzer', 'prompt-templates', 'draft-templates',
    'settings', 'account', 'activation',
  ], 'src/shared/types.ts', 'src/app/route-registry.ts', 'tests/route-registry.test.ts'),
  sidebarViews: inventory([
    'hot-board', 'queue', 'history', 'editorial-collage', 'motion-comic', 'book-selection', 'benchmark', 'person-assets',
    'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'html-video',
    'prompt-templates', 'draft-templates', 'settings', 'account', 'activation',
  ], 'src/app/navigation.ts', 'src/app/AppShell.tsx', 'tests/route-registry.test.ts'),
  createTaskInputFields: inventory([
    'title', 'inputText', 'taskKind', 'processingMode', 'publishMode', 'mode', 'aiKeyword', 'aiSources',
    'selectedSources', 'extraRequirements', 'imagePromptReference', 'track', 'style', 'speaker', 'ratio',
    'imageQuality', 'templateId', 'bgmId', 'pausePoints', 'promptTemplateId', 'promptTemplateType', 'referenceImagePath',
    'rewriteIntensity', 'narrativePov', 'keepPromotion', 'ttsProvider', 'ttsSpeed', 'storyboardSceneCount',
    'step3PromptSnapshot', 'musicMv', 'videoForm', 'llmProfileId', 'materialSource', 'productInfo',
    'materialPerson', 'draftDir', 'fixedIntro', 'outroCta', 'lockIntroSentences', 'taskType', 'pipelineStep',
    'pipelineData', 'targetLength', 'targetScenes', 'scriptFormat', 'podcastImageMode', 'podcastSpeakers',
    'podcastSpeakerA', 'podcastSpeakerB', 'coverImageMode', 'coverTemplateId', 'coverPageEnabled', 'coverPageText', 'manualCoverAssetId', 'autoBorrowImage', 'htmlVideoForeground',
  ], 'src/shared/types.ts', 'src/features/tasks/task-create-input.ts', 'tests/renderer-architecture.test.ts'),
  htmlVideoFields: inventory([
    'style', 'voiceId', 'ttsProvider', 'ttsSpeed', 'bgmId', 'captionPreset', 'captionAnim', 'captionColors', 'captionLayout',
    'bgmVolume', 'transitionType', 'sceneMotion', 'coverImageMode', 'coverTemplate', 'coverRatio', 'coverPrompt', 'draftTemplate',
    'foreground', 'maxScenes', 'ratio',
  ], 'src/shared/html-video-control-manifest.ts', 'src/features/html-video/HtmlVideoPage.tsx', 'tests/html-video-control-manifest.test.ts'),
  imageSmartModes: inventory([
    'text-to-image', 'cover', 'blog-cover', 'podcast-cover', 'video-narration', 'two-host-podcast', 'reference-edit',
  ], 'src/shared/editorial-data-contracts.ts', 'src/features/labs/ImageLabPage.tsx', 'tests/editorial-data-contracts.test.ts'),
  customCoverFields: inventory([
    'id', 'name', 'description', 'directions', 'compositionRule', 'titleLayout', 'subtitleLayout', 'plainHint',
    'createdAt', 'updatedAt',
  ], 'src/shared/editorial-data-contracts.ts', 'src/features/templates/DraftTemplatesPage.tsx', 'tests/editorial-data-contracts.test.ts'),
  minimaxCloneVoiceFields: inventory([
    'voiceId', 'displayName', 'sourceAudioPath', 'createdAt', 'lastUsedAt',
  ], 'src/shared/editorial-data-contracts.ts', 'src/features/settings/ProviderProfileManagers.tsx', 'tests/editorial-data-contracts.test.ts'),
} as const;

export const approvedConceptVisibleCopy = {
  'new-task/material/light/1440x900': ['新建任务', '素材', '创作', '输出', '开始生成'],
  'new-task/creative/light/1440x900': ['新建任务', '素材', '创作', '输出', '提示词模板'],
  'new-task/output/light/1440x900': ['新建任务', '素材', '创作', '输出', '任务队列'],
  'queue/default/light/1440x900': ['任务队列', '运行进度', '暂停', '继续', '重试'],
  'history/active/light/1440x900': ['历史任务', '搜索任务标题', '状态', '进度', '更新时间'],
  'task-detail/default/light/1440x900': ['任务详情', '流水线', '结果', '分镜', '图片', '配音', '事件'],
  'html-video/studio/light/1440x900': ['HTML 动画视频', '参数', '封面', '字幕', '出片'],
  'prompt-templates/default/light/1440x900': ['提示词模板', '筛选', '新建模板', '保存', '复制'],
  'new-task/material/light/1080x720': ['新建任务', '素材', '创作', '输出', '开始生成'],
} as const;
