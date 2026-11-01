import { workflowPrompt } from './workflow-prompt-runtime';
import type { PromptChannel } from './types';
/** Content genres, independent of writing voice and visual style. */
export interface CopywritingTrack {
  id: string;
  label: string;
  tag: string;
  description: string;
  guidance: string;
  taskTrack: string;
}

export const COPYWRITING_TRACKS: readonly CopywritingTrack[] = [
  {
    id: 'character-story', label: '人物故事', tag: '纪实人物', taskTrack: 'character-story',
    description: '从一次选择切入，用行动、代价与变化讲清一个人。',
    guidance: '开头抓住素材中一次有代价的选择或处境，不先罗列履历。按处境、选择、行动、后果推进，让细节承载人物性格；转折必须有前因，结尾回应开场的选择。只用有依据的经历和引语，不编造内心独白、苦难、对话或第一人称见证，不强行拔高人物。',
  },
  {
    id: 'folk-tale', label: '民间故事', tag: '传奇叙事', taskTrack: 'folk-tale',
    description: '讲清起因、规矩、转折与回响，保留民间讲述感。',
    guidance: '从异事、约定或未解的处境起讲，建立故事里的规矩，再沿人物行动推进，伏笔在结尾兑现。口吻有民间讲述感，避免堆古语和反复故弄玄虚。区分传说、改编与史实；有来源的传说保留版本边界，原创或改编可作合理虚构，但不冒充历史记载，不把超自然设定说成现实有效的办法。',
  },
  {
    id: 'ecommerce', label: '电商带货', tag: '种草带货', taskTrack: 'ecommerce',
    description: '真实使用场景、可证明的卖点，以及适合谁。',
    guidance: '开头给出目标人群的具体使用场景或购买难题，一条文案集中讲一个核心利益。按需求、产品如何解决、可核验的规格或演示依据、适用人群与限制推进，结尾可给一个自然的购买或比较建议。卖点必须有素材支持；不编造亲测体验、销量、评价、价格、折扣、限时库存、功效或对比结论，不用绝对化承诺催单。',
  },
  {
    id: 'book-product', label: '好书带货', tag: '阅读推荐', taskTrack: 'ecommerce',
    description: '从读者的问题切入，以真实内容说明阅读价值。',
    guidance: '先点出读者正在面对的问题，再用书中有出处的观点、章节或例子说明这本书提供什么，讲清适合谁及阅读门槛，最后自然推荐。不要空夸“必读神书”，不编造书中引文、作者身份或读后效果，不用“读完就能改变命运”等保证替代内容证据。',
  },
  {
    id: 'knowledge', label: '知识科普', tag: '通俗解释', taskTrack: 'culture-knowledge',
    description: '一个生活疑问，讲透一个知识点。',
    guidance: '从具体疑问或常见误解切入，一次只解释一个核心概念，沿例子、机制、适用边界推进。先解释必要术语，类比后说明局限，结尾给可复述的认识。数字要有来源、时间与口径，不把相关当因果，不编造研究、实验或专家意见。',
  },
  {
    id: 'culture-knowledge', label: '文化科普', tag: '历史文化', taskTrack: 'culture-knowledge',
    description: '从器物、习俗或历史疑问进入文化背景。',
    guidance: '用一件器物、一种习俗或一个历史疑问开篇，先讲观众看得见的细节，再解释时代背景、用途和文化含义，最后回到当下的理解。区分史料记载、学术解释和民间传说；存在争议时说明范围，不拼凑朝代、不杜撰典故与引文。',
  },
  {
    id: 'picture-book', label: '绘本故事', tag: '儿童绘本', taskTrack: 'picture-book',
    description: '小目标、具体动作与温和转折，适合亲子听读。',
    guidance: '围绕孩子能理解的一个小目标和一份情绪，用具体动作、可感知的物件和少量有变化的重复推进，结尾让行动回应困境。按用户指定年龄控制词汇与句长，避免抽象说教、惊吓和羞辱。原创故事可合理虚构；若改编已有绘本，保留来源边界，不照抄原作段落，不把虚构情节说成真实经历。',
  },
  {
    id: 'health-book', label: '健康图书', tag: '健康阅读', taskTrack: 'health-book',
    description: '解释书中健康知识，讲清依据与适用范围。',
    guidance: '从日常健康疑问切入，说明书中观点及其证据层级、适用人群与限制，用普通人听得懂的语言解释。区分健康教育和个人诊疗建议，不把单个案例当普遍疗效，不编造医学研究或专家背书，不保证治愈、不建议自行停药，不把读书推荐包装成诊断。',
  },
  {
    id: 'inspirational', label: '情感共鸣', tag: '情绪叙事', taskTrack: 'inspirational',
    description: '从日常处境接住情绪，给出有分寸的回应。',
    guidance: '从具体、可感知的日常处境切入，先说清感受，再通过小行动或视角变化给出回应，结尾允许留白。少用大道理和成功学口号，不贩卖焦虑、不指责受困的人，不编造亲身创伤、他人隐私或保证式人生答案。',
  },
  {
    id: 'food-vlog', label: '美食探店', tag: '餐饮体验', taskTrack: 'food-vlog',
    description: '讲清吃什么、怎么选，以及真实的体验依据。',
    guidance: '先给具体菜品、就餐场景或选择难题，再按素材里的口味、做法、份量、环境与价格信息展开，结尾说清适合谁、如何点单或哪些信息待确认。感官描述要有实际记录支持，不编造到店经历、试吃感受、排队时长、地址、价格和“本地人都来”等口碑；商业合作按用户提供的信息如实表达。',
  },
  {
    id: 'general', label: '通用故事', tag: '通用叙事', taskTrack: 'general',
    description: '围绕一个主题组织信息，用具体内容推进。',
    guidance: '先明确观众为何关心这个主题，用一个具体问题、场景或变化开篇，围绕一条主线安排信息，段落之间有因果或递进，结尾回应开头。根据题材选择叙事方式，不硬套悬念、反转、带货或互动引导，不添加素材不支持的事实。',
  },
];

const aliases: Record<string, string> = {
  'general-story': 'general', 'food-v2': 'food-vlog', 'mind-soup': 'inspirational',
  'culture-science': 'culture-knowledge', 'folk-story': 'folk-tale', '心灵鸡汤': 'inspirational', '美食探店V2': 'food-vlog',
};

export function copywritingTrack(value?: string | null): CopywritingTrack {
  const normalized = value?.trim() || 'general';
  const id = aliases[normalized] || normalized;
  return COPYWRITING_TRACKS.find(track => track.id === id || track.label === id) ?? {
    ...COPYWRITING_TRACKS[COPYWRITING_TRACKS.length - 1], id, label: id, taskTrack: id,
  };
}

export function buildCopywritingGuidance(value?: string | null, channel: PromptChannel = 'shared'): string {
  const track = copywritingTrack(value);
  return [
    '【赛道写作规则】' + track.label,
    workflowPrompt(`writing-track:${track.id}`, track.guidance, {}, channel),
    workflowPrompt("writing-expression", '【新媒体表达】先明确目标观众、具体场景和本条内容的价值；开场直接进入主题，避免“你知道吗”“震惊了”等可替换到任何选题的套话。每段推进一个信息点，优先具体动作、对照和有依据的细节，删掉重复铺垫和空泛形容。读起来像自然说话，结尾与题材相称，不强制点赞、关注、转发或购买。', {}, channel),
    workflowPrompt("writing-refinement", '【精修与优先级】修改已有文案时保留核心事实、原有口吻与用户锁定的表达，除非用户明确要求改变；不为了钩子、反转或情绪补造事实。用户的具体要求优先于赛道的默认表达建议，保持本次任务要求的输出格式与长度。', {}, channel),
  ].join('\n');
}
