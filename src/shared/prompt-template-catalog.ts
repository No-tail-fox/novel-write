import type { PromptTemplateSummary } from './types';

const promptUpdatedAt = '2026-05-26T00:00:00.000Z';
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export const promptTemplateCatalog: readonly PromptTemplateSummary[] = [
  systemTemplate('character-story', '人物故事', '历史人物 / 名人传记，纪实质感与情感渲染', 'black-white', 1781566144, 'force-extract', ['time-period', 'no-dialogue'], 'face'),
  systemTemplate('culture-knowledge', '文化科普', '华夏文化 / 传统民俗 / 国学智慧，物件与场景驱动', 'ancient-cinematic', 1779612568, 'force-skip', ['time-period', 'no-dialogue'], 'product'),
  systemTemplate('ecommerce', '电商带货', '产品种草 / 好物推荐，痛点+效果+促单结构', 'realistic', 1779614885, 'force-skip', ['no-dialogue'], 'product'),
  systemTemplate('folk-tale', '民间故事', '虚构传说 / 因果寓言 / 乡土传奇，工笔风叙事，适合清代/古风背景的善念化险类故事；封面固定双行「民间故事 / 《主旨》」', 'folk-tale-gongbi', 1780130111, 'force-extract', ['time-period', 'no-dialogue'], 'face'),
  systemTemplate('food-vlog', '美食探店V2', '城市街角小店的烟火气与老板真实故事', 'vintage-film', 1779182583, 'force-skip', ['no-dialogue'], 'product'),
  systemTemplate('general', '通用故事', '通用写实风，没有特定赛道时的兜底', 'realistic', 1779149852, 'follow-template', [], 'face'),
  systemTemplate('health-book', '健康图书', '健康养生 / 医学知识，印象派油画调性，多元意象（食物 / 草药 / 自然 / 书页）穿插少量温馨人物', 'oil-painting', 1779610217, 'force-skip', ['no-dialogue'], 'product'),
  systemTemplate('inspirational', '心灵鸡汤', '情感治愈 / 励志感悟 / 深夜电台，氛围意象驱动', 'cinematic', 1779611218, 'force-skip', [], 'face'),
  systemTemplate('picture-book', '绘本故事', '儿童绘本 / 睡前故事，可爱角色与梦幻场景', 'pixar-3d', 1779614152, 'force-extract', ['no-dialogue'], 'face'),
  builtinTemplate('builtin-review', '预审整理', 'review', '清洗素材、去噪、压缩为适合短视频的事实文案。', promptUpdatedAt),
  builtinTemplate('builtin-rewrite', 'StoryDream 通用改写', 'rewrite', 'StoryDream 通用故事赛道改写提示词兜底。', iso(1779149852)),
  builtinTemplate('builtin-cover', 'StoryDream 通用封面信息', 'cover', 'StoryDream 通用故事赛道封面标题与视频简介提示词兜底。', iso(1779149852)),
  builtinTemplate('builtin-storyboard', 'StoryDream 本地化分镜', 'storyboard', '按 Storybound 最新分镜规则输出尾部锚点，由 StoryDream 本地还原字幕分镜。', promptUpdatedAt),
  builtinTemplate('builtin-image-prompt', 'StoryDream 通用绘图提示词', 'image-prompt', 'StoryDream 通用故事赛道分镜绘画提示词兜底。', iso(1779149852)),
];

function systemTemplate(
  track: string,
  name: string,
  description: string,
  style: string,
  updatedAt: number,
  characterPolicy: NonNullable<PromptTemplateSummary['characterPolicy']>,
  step3SkeletonModules: string[],
  referenceKind: NonNullable<PromptTemplateSummary['referenceKind']>,
): PromptTemplateSummary {
  return {
    id: `system-${track}`,
    name,
    type: 'task',
    description,
    isBuiltin: true,
    updatedAt: iso(updatedAt),
    baseTrack: track,
    defaultStyles: [style],
    characterPolicy,
    step3SkeletonModules,
    referenceKind,
    origin: 'system',
  };
}

function builtinTemplate(
  id: string,
  name: string,
  type: PromptTemplateSummary['type'],
  description: string,
  updatedAt: string,
): PromptTemplateSummary {
  return { id, name, type, description, isBuiltin: true, updatedAt, origin: 'system' };
}
