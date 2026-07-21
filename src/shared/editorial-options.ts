import type {
  ImageLabSmartMode,
  JianyingEffectCatalog,
  PausePoint,
  PromptStepTemplateType,
  PromptTemplate,
  PromptTemplateType,
  RewriteIntensity,
} from './types';
import type { TemplateOption } from './prompt-templates';

export const sampleText =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

export const contentTracks = [
  ['character-story', '人物故事', '历史人物 / 名人传记'],
  ['health-book', '健康图书', '健康养生 / 医学知识'],
  ['culture-science', '文化科普', '华夏文化 / 传统民俗'],
  ['picture-book', '绘本故事', '儿童绘本 / 睡前故事'],
  ['ecommerce', '电商带货', '产品种草 / 好物推荐'],
  ['mind-soup', '心灵鸡汤', '情感治愈 / 励志感悟'],
  ['folk-story', '民间故事', '虚构传说 / 因果寓言'],
  ['general-story', '通用故事', '通用写实风格'],
  ['food-v2', '美食探店V2', '城市街角小店的烟火气'],
];

export const styleOptions: TemplateOption[] = [
  ['black-white', '黑白摄影', '纪实感'],
  ['photo-real', '写实彩色', '质感胶片'],
  ['oil-paint', '油画风格', '印象写意'],
  ['modern-film', '现代电影', '宽屏调色'],
  ['ancient-film', '古风电影', '古代史诗'],
  ['retro-film', '复古胶片', '80年代街拍'],
  ['watercolor', '水彩治愈', '柔和晕染'],
  ['magazine', '杂志插画', '极简色块'],
  ['pixar-3d', '皮克斯 3D', '动画质感'],
  ['ink', '中国水墨', '文人意境'],
  ['folk', '民间故事工笔风', '工笔叙事'],
  ['ghibli', '吉卜力', '治愈日漫'],
];
export const htmlVideoStyleOptions = styleOptions;
export const ratioOptions = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
export const smartImageModeOptions: Array<[ImageLabSmartMode, string, string]> = [
  ['cover', '封面', '短视频主封面'],
  ['blog-cover', '博客封面', '文章首图 / 横版主图'],
  ['podcast-cover', '播客封面', '节目感双人或主题封面'],
  ['video-narration', '旁白视频', '单人讲述主视觉'],
  ['two-host-podcast', '双人播客', '两位主播一问一答'],
  ['reference-edit', '参考图编辑', '参考图一致性改图'],
];
export const storyboardSceneCountOptions = [8, 12, 16, 20, 30];
export const siliconFlowSpeechToTextBaseUrl = 'https://api.siliconflow.cn/v1';
export const siliconFlowSpeechToTextModels = ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'];
export const volcengineVoicePresets = [
  ['Vivi 2.0', 'zh_female_vv_uranus_bigtts'],
  ['云舟 2.0', 'zh_male_m191_uranus_bigtts'],
  ['爽快思思 2.0', 'zh_female_shuangkuaisisi_uranus_bigtts'],
  ['儒雅青年 2.0', 'zh_male_ruyaqingnian_uranus_bigtts'],
  ['悬疑解说 2.0', 'zh_male_xuanyijieshuo_uranus_bigtts'],
] as const;
export const pauseOptions: Array<[PausePoint, string]> = [
  ['none', '不暂停'],
  ['critical', '关键节点'],
  ['every-step', '每步确认'],
  ['custom', '自定义'],
];
export const rewriteOptions: Array<[RewriteIntensity, string]> = [
  ['standard', '标准改写'],
  ['deep', '深度改写'],
  ['original', '高度原创'],
];
export const povOptions = [
  ['keep-original', '保持原文'],
  ['first-person', '第一人称'],
  ['third-person', '第三人称'],
] as const;
export const promptTemplateTypeOptions: Array<PromptTemplateType | 'all'> = ['all', 'task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'];
export const promptTemplateTypeLabels: Record<PromptTemplateType | 'all', string> = {
  all: '全部类型',
  task: '任务模板',
  review: '预审提示词',
  rewrite: '改写提示词',
  cover: '封面元数据提示词',
  storyboard: '分镜提示词',
  'image-prompt': '出图提示词',
};
export type PromptTemplateVariableScope = PromptTemplateType;
export const promptTemplateVariableDefinitions = [
  { key: 'inputText', label: '原文素材', description: '新建任务里粘贴或导入的原始文案', scopes: ['task', 'review'] },
  { key: 'title', label: '任务标题', description: '当前任务标题或自动生成标题', scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'sourceContext', label: '联网资料', description: 'AI 搜索或知识库带回来的参考资料', scopes: ['review'] },
  { key: 'reviewedText', label: '预审结果', description: 'Step 0 清洗、去重后的事实素材', scopes: ['rewrite', 'cover'] },
  { key: 'rewrittenCopy', label: '改写正文', description: 'Step 1 改写后的口播文案', scopes: ['storyboard'] },
  { key: 'scenesJson', label: '分镜数据', description: 'Step 2 拆出来的分镜 JSON', scopes: ['image-prompt'] },
  { key: 'track', label: '内容赛道', description: '人物故事、健康图书、电商等赛道', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'style', label: '画风', description: '任务选择的出图风格', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'ratio', label: '画面比例', description: '9:16、16:9 等画布比例', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'extraRequirements', label: '额外要求', description: '新建任务里填写的补充要求', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'rewriteIntensity', label: '改写强度', description: '新建任务高级设置里的改写强度', scopes: ['rewrite'] },
  { key: 'narrativePov', label: '叙事视角', description: '新建任务高级设置里的叙事视角', scopes: ['rewrite'] },
  { key: 'keepPromotion', label: '保留带货', description: '新建任务高级设置里的带货保留开关', scopes: ['rewrite', 'cover'] },
  { key: 'aiKeyword', label: 'AI 关键词', description: 'AI 创作模式里的检索关键词', scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'taskTemplateContent', label: '任务模板指令', description: '当前模板的任务总指令渲染结果；不要放在任务总指令内', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'taskTemplateName', label: '任务模板名称', description: '当前故事模板名称', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'defaultStyles', label: '默认画风', description: '当前故事模板绑定的默认图像模板', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'defaultDraftTemplateId', label: '默认草稿模板', description: '当前故事模板绑定的剪映草稿模板 ID', scopes: ['task'] },
  { key: 'characterPolicy', label: '角色档案策略', description: '当前故事模板是否强制提取或跳过角色档案', scopes: ['task', 'image-prompt'] },
  { key: 'step3SkeletonModules', label: 'Step 3 骨架', description: '当前故事模板启用的绘图骨架模块', scopes: ['storyboard', 'image-prompt'] },
  { key: 'referenceKind', label: '参考图类型', description: '当前故事模板使用的人脸、产品或无参考图类型', scopes: ['storyboard', 'image-prompt'] },
  { key: 'stylePrefix', label: '风格前缀', description: '当前图像模板的 prefix，会注入 Step 3 出图提示词', scopes: ['image-prompt'] },
  { key: 'styleSuffix', label: '风格后缀', description: '当前图像模板的 suffix，会注入 Step 3 出图提示词', scopes: ['image-prompt'] },
  { key: 'styleAllowColor', label: '允许色彩词', description: '当前图像模板是否允许在画面里使用具体色彩词', scopes: ['image-prompt'] },
  { key: 'styleNegativePrompt', label: '负面提示词', description: '当前图像模板的 negative prompt', scopes: ['image-prompt'] },
  { key: 'referenceImagePath', label: '参考图路径', description: '新建任务上传或填写的参考图本地路径', scopes: ['image-prompt'] },
  { key: 'imagePromptReference', label: '生图参考', description: '爆款拆解或用户补充的画面参考提示', scopes: ['image-prompt'] },
  { key: 'characterCard', label: '角色档案', description: 'Step 3 前提取出的角色一致性 JSON', scopes: ['image-prompt'] },
  { key: 'imageSeedPoolsJson', label: '图片种子池', description: '当前故事模板携带的 StoryDream 图片种子池 JSON', scopes: ['image-prompt'] },
] satisfies Array<{ key: string; label: string; description: string; scopes: PromptTemplateVariableScope[] }>;
export const promptTemplateVariables = promptTemplateVariableDefinitions.map((item) => item.key);
export const promptStepEditorDefinitions: Array<{ type: PromptStepTemplateType; label: string; hint: string }> = [
  { type: 'review', label: 'Step 0 预审', hint: '清理输入素材、保留事实顺序、去掉重复表达' },
  { type: 'rewrite', label: 'Step 1 改写', hint: '控制口播文案的语言、节奏和结构' },
  { type: 'cover', label: 'Step 1 元数据', hint: '生成标题、摘要、标签和评论的规则' },
  { type: 'storyboard', label: 'Step 2 分镜', hint: '控制分镜拆句、镜头节奏和场景数量' },
  { type: 'image-prompt', label: 'Step 3 出图', hint: '控制出图提示词、角色一致性和安全规则' },
];
export const promptTemplateStep3SkeletonOptions = ['跨年代', '防台词文字', '产品一致性'];
export const promptTemplateReferenceOptions: Array<[NonNullable<PromptTemplate['referenceKind']>, string]> = [
  ['none', '无'],
  ['face', '人脸'],
  ['product', '产品'],
];
export const fallbackEffectCatalog: JianyingEffectCatalog = {
  status: 'warn',
  detail: '未读取到剪映特效目录，已使用本地基础转场清单。',
  transitions: ['叠化'],
  filters: [],
  videoEffects: [],
  audioEffects: [],
};
