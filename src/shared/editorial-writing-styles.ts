/** Editorial writing guidance is separate from visual style and user requirements. */
export const EDITORIAL_WRITING_STYLE_IDS = ['documentary', 'story', 'commentary', 'popular-science', 'data', 'cultural-essay'] as const;
export type EditorialWritingStyleId = typeof EDITORIAL_WRITING_STYLE_IDS[number];
export const DEFAULT_EDITORIAL_WRITING_STYLE: EditorialWritingStyleId = 'documentary';

export const EDITORIAL_WRITING_STYLES: ReadonlyArray<{
  id: EditorialWritingStyleId;
  label: string;
  description: string;
  guidance: string;
  example: string;
}> = [
  {
    id: 'documentary', label: '纪实解释', description: '从现象追到原因，克制、清楚、有依据。',
    guidance: '采用克制、清晰的纪实解释口吻，从可观察的现象引出问题，交代背景，再用有来源的事实解释因果，最后归纳认识。区分事实、推测和观点，不编造数字、引语或具体人物。',
    example: '一家旧书店的价值，不只在书架上。读者在这里发现旧书，也交换消息。理解它为何被需要，要从书的流通，看到人与社区的联系。',
  },
  {
    id: 'story', label: '故事叙事', description: '以人物和场景开篇，用变化推动叙述。',
    guidance: '采用故事叙事结构，用素材中已有的人物或场景引入，沿着事件变化、阻力和转折推进，再落到主题认识。素材不足时用明确的设想或普遍场景，不把虚构经历、对话或人物冒充事实。',
    example: '推开旧书店的门，你原本只想找一本书。翻页时，一张前任读者留下的书签滑了出来。此刻，你接过的不只是一本旧书，也是另一个人读到这里的瞬间。',
  },
  {
    id: 'commentary', label: '观点评论', description: '先亮观点，再给理由，也回应反面意见。',
    guidance: '采用有判断但不过度煽动的评论口吻，明确核心观点，以素材中的事实和逻辑论证，回应一个合理的反面观点，说明适用边界。区分价值判断与事实，不用未经证实的指控制造冲突。',
    example: '评价旧书店，不能只问买书够不够方便。便利当然重要，但偶然发现一本书、与陌生读者交谈，同样有价值。值得讨论的是，城市愿意给这样的相遇留下多少空间。',
  },
  {
    id: 'popular-science', label: '轻松科普', description: '用生活类比解释概念，轻松但准确。',
    guidance: '采用自然、轻松的科普口吻，先提出一个具体疑问，用贴近日常的类比解释概念，再补充类比的局限。短句为主，每段只讲一个要点，解释必要术语，不牺牲准确性追求段子。',
    example: '旧书店为什么总能让人多逛一会儿？可以把书架想成一张没有搜索框的地图。你不是直奔答案，而是在相邻的书脊之间发现新方向。这就是偶然发现的乐趣。',
  },
  {
    id: 'data', label: '数据解读', description: '交代口径与比较对象，再说明数字的含义。',
    guidance: '采用清楚严谨的数据解读结构，先定义指标和比较对象，交代时间范围、来源与统计口径，再解释差异及其可能原因。没有可信数字时说明缺少什么数据，不编造百分比、排名或趋势；相关性不能直接写成因果。',
    example: '要判断旧书店是否变少，先要统一比较口径：哪座城市、哪段时间，什么样的店才算旧书店？门店数量、营业面积和到店人数回答的是不同问题，不能混作一个结论。',
  },
  {
    id: 'cultural-essay', label: '文化随笔', description: '从细节展开联想，保留余味与具体观察。',
    guidance: '采用有细节、有节制的文化随笔口吻，从具体物件或生活观察展开文化联想，把个人感受与历史事实分开。节奏舒缓但不空泛，避免堆砌形容词与强行升华，不杜撰典故、引用或历史细节。',
    example: '旧书的纸页，有一种被时间放慢的触感。折角、批注和褪色的书签，让阅读留下了痕迹。走进旧书店，像是暂时离开不断刷新的屏幕，听一听纸张保存的回声。',
  },
];

export function editorialWritingStyle(id?: string) {
  return EDITORIAL_WRITING_STYLES.find((style) => style.id === id) ?? EDITORIAL_WRITING_STYLES[0];
}
