import type { CustomStyle, PromptTemplate, ViralAnalysisResult, ViralFrameAnalysis } from './types';

export interface ViralTemplateDraftOptions {
  storyTemplateName: string;
  imageTemplateName: string;
  track: string;
  style: string;
  draftTemplateId: string;
  now?: string;
  storyTemplateId?: string;
  imageTemplateId?: string;
}

export interface ViralTemplateDrafts {
  storyTemplate: PromptTemplate;
  imageTemplate: CustomStyle;
}

export function createViralTemplateDrafts(result: ViralAnalysisResult, options: ViralTemplateDraftOptions): ViralTemplateDrafts {
  const storyTemplateName = options.storyTemplateName.trim();
  const imageTemplateName = options.imageTemplateName.trim();
  if (!storyTemplateName) throw new Error('故事模板名不能为空。');
  if (!imageTemplateName) throw new Error('图片模板名不能为空。');

  const now = options.now ?? new Date().toISOString();
  const imageTemplateId = options.imageTemplateId ?? createViralTemplateId('viral-image');
  const storyTemplateId = options.storyTemplateId ?? createViralTemplateId('viral-story');
  const frameSummary = result.frames.map(viralFrameTemplateLine).filter(Boolean);
  const imagePrompts = result.frames.map((frame) => frame.imagePrompt.trim()).filter(Boolean);
  const textOverlays = result.frames.map((frame) => frame.textOverlay?.trim() ?? '').filter(Boolean);
  const breakdown = result.contentBreakdown;
  const sourceTitle = result.source.title || breakdown.topic || '短视频';
  const context: ViralFormulaContext = {
    sourceTitle,
    result,
    frameSummary,
    imagePrompts,
    textOverlays,
    track: options.track,
    style: options.style,
  };

  const imageTemplate: CustomStyle = {
    id: imageTemplateId,
    name: imageTemplateName,
    tag: '爆款拆解',
    shortName: imageTemplateName.slice(0, 12),
    prefix: buildViralImageStylePrefix(context),
    suffix: buildViralImageStyleSuffix(context),
    negativePrompt: [
      '照抄原视频文字',
      '复用原账号标识',
      '搬运水印',
      '原视频逐帧复刻',
      '低清晰度',
      '变形文字',
      '错误手指',
      '畸形五官',
      '画面元素堆砌',
      '过度相似的原视频镜头',
    ].join('、'),
    allowColor: true,
    description: compactLines([
      `由爆款拆解生成：${sourceTitle}`,
      `爆点：${breakdown.viralPoint.summary}`,
      `可复用画面模式：${breakdown.cover.pattern || breakdown.viralPoint.reusablePattern}`,
    ]),
    createdAt: now,
    updatedAt: now,
  };

  const storyTemplate: PromptTemplate = {
    id: storyTemplateId,
    name: storyTemplateName,
    type: 'task',
    description: '由爆款拆解保存的公式化文案与生图模板',
    content: buildViralFormulaTaskContent(context),
    isBuiltin: false,
    updatedAt: now,
    baseTrack: options.track,
    defaultStyles: [imageTemplate.id],
    defaultDraftTemplateId: options.draftTemplateId,
    characterPolicy: 'follow-template',
    referenceKind: 'none',
    stepPrompts: {
      review: buildViralReviewPrompt(context),
      rewrite: buildViralRewritePrompt(context),
      cover: buildViralCoverPrompt(context),
      storyboard: buildViralStoryboardPrompt(context),
      'image-prompt': buildViralImagePromptTemplate(context),
    },
    origin: 'custom',
    marketTags: ['爆款拆解'],
  };

  return { storyTemplate, imageTemplate };
}

interface ViralFormulaContext {
  sourceTitle: string;
  result: ViralAnalysisResult;
  frameSummary: string[];
  imagePrompts: string[];
  textOverlays: string[];
  track: string;
  style: string;
}

function buildViralFormulaTaskContent(context: ViralFormulaContext): string {
  const { result, sourceTitle, frameSummary, imagePrompts, textOverlays } = context;
  const { contentBreakdown: breakdown, recreation } = result;
  return compactLines([
    '# 爆款公式化模板',
    '',
    '## 任务总指令',
    '请基于用户素材 {{inputText}} 创作一个全新的短视频故事。这个模板只复用原爆款的叙事结构、节奏、信息排序、情绪曲线、镜头组织和缩略图逻辑，不复用原文句子、原标题、原账号话术、人物身份、专属案例或原视频独特表达。不要照抄原文。',
    '后续每一步都以前面这些公式作为底稿：先抽象，再迁移，再生成新内容。',
    '',
    '## 来源抽象',
    `来源标题：${sourceTitle}`,
    `适用赛道：${context.track || '通用短视频'}`,
    `参考画风：${context.style || '跟随任务画风'}`,
    `参考主题：${breakdown.topic || sourceTitle}`,
    '',
    '## 文案公式',
    `标题模式：${fallbackText(breakdown.title.pattern, '用一句高辨识度承诺、痛点或反差先锁定注意力')}`,
    breakdown.title.suggestions.length ? `可迁移标题方向：${breakdown.title.suggestions.join(' / ')}` : '',
    `开头类型：${breakdown.opening.type}`,
    `开头公式：${fallbackText(breakdown.opening.reusablePattern, '先给结果、冲突、强观点或强利益，再补背景')}`,
    `开头分析：${fallbackText(breakdown.opening.analysis, '开场要在 3 秒内让观众知道为什么要继续看')}`,
    `结构类型：${breakdown.structure.type}`,
    `结构公式：${fallbackText(breakdown.structure.analysis, '用清晰递进把痛点、证据、解决方案和结果串起来')}`,
    breakdown.structure.outline.length ? `结构大纲：${breakdown.structure.outline.join(' -> ')}` : '',
    `结尾类型：${breakdown.ending.type}`,
    `结尾公式：${fallbackText(breakdown.ending.reusablePattern, '用总结、行动提示、反问或下一集预告收束')}`,
    `爆点总结：${fallbackText(breakdown.viralPoint.summary, '让观众觉得有用、有情绪、有身份代入或有强反差')}`,
    `爆点迁移规则：${fallbackText(breakdown.viralPoint.reusablePattern, '迁移关系和爽点，不迁移原始素材')}`,
    breakdown.viralPoint.evidence.length ? `爆点证据：${breakdown.viralPoint.evidence.join(' / ')}` : '',
    recreation.blueprint ? `复刻蓝图：${recreation.blueprint}` : '',
    '',
    '## 画面公式',
    `封面模式：${fallbackText(breakdown.cover.pattern || breakdown.cover.observed, '主体明确、利益点前置、对比强、缩略图可读')}`,
    breakdown.cover.suggestions.length ? `封面迁移方向：${breakdown.cover.suggestions.join(' / ')}` : '',
    frameSummary.length ? `关键帧抽象：${frameSummary.join(' / ')}` : '关键帧抽象：围绕开场钩子、痛点证据、解决动作、结果反馈安排镜头。',
    imagePrompts.length ? `生图提示词参考：${imagePrompts.join(' / ')}` : '',
    textOverlays.length ? `文字覆盖规律：${textOverlays.join(' / ')}` : '文字覆盖规律：只保留短词级信息层级，不照搬原视频字幕。',
    recreation.storyboardHints.length ? `分镜提示：${recreation.storyboardHints.join(' / ')}` : '',
    '',
    '## 变量入口',
    '- 原文素材：{{inputText}}',
    '- 额外要求：{{extraRequirements}}',
    '',
    '## 禁止事项',
    '禁止照抄原文、原标题、原账号口癖、原视频字幕、原人物身份、原品牌露出、原评论区话术和可识别水印。所有新任务都必须换成用户输入的新主题、新场景、新案例和新表达。',
  ]);
}

function buildViralReviewPrompt(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown } = context.result;
  return compactLines([
    '# Step 0 预审',
    '目标：清理输入素材，把用户的新素材整理成可套用爆款公式的事实底稿。',
    '',
    '任务模板：{{taskTemplateContent}}',
    '',
    '素材：{{inputText}}',
    '',
    '资料来源：{{sourceContext}}',
    '',
    '## 预审规则',
    `1. 保留和新主题相关的事实、人物、产品、场景、时间线、结果证据，删除重复、跑题和明显广告噪音。`,
    `2. 按原爆款的结构入口整理信息：开头要服务「${fallbackText(breakdown.opening.reusablePattern, '结果或冲突前置')}」；中段要服务「${fallbackText(breakdown.structure.analysis, '递进证明')}」；结尾要服务「${fallbackText(breakdown.ending.reusablePattern, '自然收束')}」。`,
    '3. 如果素材信息不足，允许标注“可补充信息”，但不要编造事实。',
    '4. 去掉原账号引流、平台水印、评论区口吻和任何不可迁移的专属表达。',
    '5. 输出是一段中文事实简稿，供 Step 1 改写使用；不要输出 Markdown 标题，不要提前写成最终口播稿。',
  ]);
}

function buildViralRewritePrompt(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown, recreation } = context.result;
  return compactLines([
    '# 文案提示词模板',
    '目标：把 {{reviewedText}} 改写成一条全新的爆款短视频口播文案。只继承公式，不继承原素材表达。',
    '',
    '任务模板：{{taskTemplateContent}}',
    '',
    '预审结果：{{reviewedText}}',
    '',
    '额外要求：{{extraRequirements}}',
    '',
    '## 爆款文案公式',
    `开头公式：${fallbackText(breakdown.opening.reusablePattern, '前 1-2 句直接抛出结果、冲突、痛点或反常识观点')}。开头必须让观众立刻知道“这和我有什么关系”。`,
    `结构公式：${fallbackText(breakdown.structure.analysis, '按痛点 -> 证据 -> 方法 -> 结果递进')}。每一段只推进一个信息，不绕弯，不堆概念。`,
    breakdown.structure.outline.length ? `结构骨架：${breakdown.structure.outline.map((item, index) => `${index + 1}. ${item}`).join(' / ')}` : '',
    '转折/递进公式：每 2-4 句安排一次推进，可以用“但问题是”“真正关键是”“所以你会发现”“更重要的是”这类自然口语连接，让信息从现象走向原因、方法和结果。',
    `结尾公式：${fallbackText(breakdown.ending.reusablePattern, '用总结、行动提示、反问或下一个期待点收尾')}。结尾要给观众一个保存、转发、评论或继续观看的理由，但不要生硬喊口号。`,
    `爆点迁移规则：${fallbackText(breakdown.viralPoint.reusablePattern, '保留爽点关系、反差和获得感，把人物、行业、场景全部替换为新素材')}。`,
    `爆点总结：${fallbackText(breakdown.viralPoint.summary, '信息要有用、情绪要明确、收益要可感知')}`,
    breakdown.viralPoint.evidence.length ? `可复用证据类型：${breakdown.viralPoint.evidence.join(' / ')}` : '',
    recreation.blueprint ? `复刻蓝图：${recreation.blueprint}` : '',
    recreation.openingOptions.length ? `可选开场方向：${recreation.openingOptions.join(' / ')}` : '',
    '',
    '## 改写硬约束',
    '- 禁止照抄原文、原标题、原账号表达、原视频字幕、原人物身份、原具体案例和原品牌露出。',
    '- 禁止只替换关键词。必须重组句式、场景、论证顺序和表达细节。',
    '- 必须适合 TTS 朗读：短句、口语、节奏清楚，不写镜头标注、括号说明、Markdown 标题或列表。',
    '- 新文案要有系列化能力：同一个公式可以继续换主题复刻，因此不要写死只有本条素材才能成立的桥段。',
    '- 如用户素材包含带货信息，保留利益点和信任状，但弱化硬广腔。',
    '',
    '## 输出要求',
    '输出 rewrittenCopy：一段可直接配音的中文正文，段落之间用空行分隔。长度遵循 {{targetLength}}，如果未设置则以原素材信息量为准。',
  ]);
}

function buildViralCoverPrompt(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown, recreation } = context.result;
  return compactLines([
    '# Step 1 元数据',
    '目标：根据爆款标题/封面规律，生成新任务的视频标题、封面副标题、摘要、标签和评论引导。',
    '',
    '任务模板：{{taskTemplateContent}}',
    '',
    '预审结果：{{reviewedText}}',
    '',
    '说明：Step 1 会同时生成 rewrittenCopy 和 cover，请基于本轮即将生成的口播正文逻辑同步生成封面信息，不要依赖尚未落盘的改写正文变量。',
    '',
    '## 标题公式',
    `标题模式：${fallbackText(breakdown.title.pattern, '痛点/结果/反差前置，用短句制造点击理由')}`,
    breakdown.title.suggestions.length ? `标题迁移方向：${breakdown.title.suggestions.join(' / ')}` : '',
    '- 标题要抽象复刻原爆款的注意力机制：强利益、强反差、强身份、强问题或强结果。',
    '- 不使用原标题、原账号口头禅和原视频独有词。',
    '',
    '## 封面公式',
    `封面模式：${fallbackText(breakdown.cover.pattern || breakdown.cover.observed, '主体清晰、关键词短、对比强、缩略图一眼可懂')}`,
    breakdown.cover.suggestions.length ? `封面迁移方向：${breakdown.cover.suggestions.join(' / ')}` : '',
    recreation.coverIdeas.length ? `可选封面想法：${recreation.coverIdeas.join(' / ')}` : '',
    '- subtitle 每行控制在 12 字以内，优先使用结果词、痛点词、身份词、反差词。',
    '- summary 用一句话说明视频价值，不要写成平台介绍。',
    '- comments 给 3-5 条可用于评论区置顶/互动的短句，必须服务新主题。',
  ]);
}

function buildViralStoryboardPrompt(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown, recreation } = context.result;
  return compactLines([
    '# Step 2 分镜',
    '目标：把最终口播稿拆成可生产的连续分镜，复刻原爆款的节奏和镜头功能，不复刻原画面。',
    '',
    '最终口播稿：{{rewrittenCopy}}',
    '',
    '任务模板：{{taskTemplateContent}}',
    '',
    '目标字数：{{targetLength}}',
    '目标分镜数：{{storyboardSceneCount}}',
    '画面比例：{{ratio}}',
    '当前画面风格：{{style}}',
    '参考图类型：{{referenceKind}}',
    'Step 3 骨架：{{step3SkeletonModules}}',
    '额外要求：{{extraRequirements}}',
    '',
    '## 分镜公式',
    `1. 开场镜头：对应「${fallbackText(breakdown.opening.reusablePattern, '结果/冲突前置')}」，第一镜必须有明确主体和强信息点。`,
    `2. 中段镜头：对应「${fallbackText(breakdown.structure.analysis, '递进结构')}」，按信息推进分配镜头，每个镜头只承载一个动作、证据、情绪或场景变化。`,
    `3. 爆点镜头：对应「${fallbackText(breakdown.viralPoint.reusablePattern, '反差/收益/身份代入')}」，用特写、对比、结果展示或关键物件放大获得感。`,
    `4. 收尾镜头：对应「${fallbackText(breakdown.ending.reusablePattern, '总结或行动提示')}」，画面要有完成感或下一步期待。`,
    recreation.storyboardHints.length ? `5. 原爆款分镜提示抽象：${recreation.storyboardHints.join(' / ')}` : '',
    '',
    '## 输出规则',
    '- 返回 scenes JSON。cap 是最终字幕/口播片段，必须能被 TTS 朗读。',
    '- descPrompt 只写可见画面、镜头、场景、人物/产品线索，不要复述完整字幕。',
    '- 不要写屏幕文字、标题、字幕、水印、UI、账号名。',
    '- 保持人物/产品/地点/时代连续性，穿插特写、中景、全景和建立镜头。',
    '- durationMs 按 cap 字数和节奏估算。',
  ]);
}

function buildViralImagePromptTemplate(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown } = context.result;
  const keyframeFormula = context.frameSummary.length
    ? context.frameSummary.join(' / ')
    : '开场强钩子镜头 / 中段证据或过程镜头 / 结果反馈镜头 / 收尾完成感镜头';
  const imagePromptReference = context.imagePrompts.length ? context.imagePrompts.join(' / ') : '使用用户新主题重新生成，不复用原视频逐帧画面。';
  const textOverlayRule = context.textOverlays.length ? context.textOverlays.join(' / ') : '如需文字层级，只保留短词级视觉位置，不在图片里生成真实字幕。';

  return compactLines([
    '# 生图提示词模板',
    '目标：把分镜 {{scenesJson}} 转成高质量生图提示词。复刻原爆款的画面功能、镜头节奏、构图关系和情绪强度，不复刻原视频画面。',
    '',
    '任务模板：{{taskTemplateContent}}',
    '',
    '生图参考：{{imagePromptReference}}',
    '',
    '当前画面风格：{{style}}',
    '风格前缀：{{stylePrefix}}',
    '风格后缀：{{styleSuffix}}',
    '允许色彩词：{{styleAllowColor}}',
    '负面提示词：{{styleNegativePrompt}}',
    '参考图路径：{{referenceImagePath}}',
    '角色档案：{{characterCard}}',
    '图片种子池：{{imageSeedPoolsJson}}',
    '',
    '## 画面公式',
    `构图公式：${fallbackText(breakdown.cover.pattern || breakdown.cover.observed, '主体占据视觉中心或黄金分割点，背景服务主题，缩略图一眼可读')}。每张图都要有清楚主次关系。`,
    `镜头公式：${keyframeFormula}`,
    `文字层级公式：${textOverlayRule}。不要把长字幕、账号名、水印或标题直接画进图里；如必须表现文字，只用“干净留白/标题区域/短标签感”描述。`,
    `关键帧抽象：${imagePromptReference}`,
    '角色/产品一致性：同一人物、产品、服装、场景和时代设定必须跨镜头连续；如果有 {{characterCard}}，优先遵守角色档案；如果是带货或产品类内容，产品外观、材质、颜色和使用场景必须稳定。',
    '',
    '## 每条 prompt 必须包含',
    '- 主体：人物/产品/场景中最重要的可见对象。',
    '- 动作：这一镜正在发生什么，只写一个核心动作或状态。',
    '- 场景：地点、时间、环境氛围和必要道具。',
    '- 镜头：特写/中景/全景/俯拍/推近/固定镜头等，用来匹配原爆款节奏。',
    '- 光线与质感：继承 {{stylePrefix}} 和 {{styleSuffix}} 的视觉方向，再结合新主题细化。',
    '- 情绪：对应文案当下的紧张、好奇、释然、惊喜、信任或行动感。',
    '',
    '## 安全规则',
    '- 禁止照抄原视频画面、原字幕、原品牌露出、原账号头像、水印和平台 UI。',
    '- 禁止生成不可读大段文字、畸形五官、错误手指、低清晰度、过度拥挤背景。',
    '- 不要让画面出现和文案无关的随机符号、假 logo、假二维码。',
    '- 如果原爆款含有高风险元素，只保留“冲突强度”，改成安全、合规、可商用的新表达。',
    '',
    '## 输出格式',
    '返回 imagePrompts JSON。每个 prompt 都要是可直接发给生图模型的完整中文/中英混合提示词；negativePrompt 合并 {{styleNegativePrompt}} 和本模板安全规则；style 填 {{style}}；ratio 填 {{ratio}}。',
  ]);
}

function buildViralImageStylePrefix(context: ViralFormulaContext): string {
  const { contentBreakdown: breakdown } = context.result;
  return compactLines([
    `爆款拆解视觉风格，来源主题：${context.sourceTitle}`,
    `封面/首帧模式：${fallbackText(breakdown.cover.pattern || breakdown.cover.observed, '主体清晰、强对比、缩略图可读')}`,
    context.frameSummary.length ? `画面结构抽象：${context.frameSummary.join(' / ')}` : '',
    `当前风格：${context.style}`,
    '要求：复刻构图关系、视觉层级、镜头功能和情绪强度，替换为新主题的新画面。',
  ]);
}

function buildViralImageStyleSuffix(context: ViralFormulaContext): string {
  return compactLines([
    context.imagePrompts.length ? `关键帧提示词抽象：${context.imagePrompts.join(' / ')}` : '',
    context.textOverlays.length ? `文字覆盖规律：${context.textOverlays.join(' / ')}` : '',
    '保持画面干净、主体明确、焦点突出、短视频缩略图可读；不要生成原视频文字、水印、账号标识或逐帧复刻画面。',
  ]);
}

function createViralTemplateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function viralFrameTemplateLine(frame: ViralFrameAnalysis): string {
  return compactLines([
    frame.composition,
    frame.shotType,
    frame.mood,
    frame.visualDescription,
    frame.keyElements.length ? `关键元素：${frame.keyElements.join('、')}` : '',
  ], '，');
}

function compactLines(lines: string[], separator = '\n'): string {
  return lines.map((line) => line.trim()).filter(Boolean).join(separator);
}

function fallbackText(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}
