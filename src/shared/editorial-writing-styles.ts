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
    guidance: '开头从素材中一个具体变化、反常现象或可观察的细节提出中心问题，让观众马上知道这件事与自己有什么关系。只补理解问题必需的背景，再沿事实、证据和因果逐步解释，结尾回答开头的问题。口吻克制，短句承接；区分事实、推测和观点，不编造数字、引语或人物，不用“背后究竟隐藏着什么”代替解释。',
    example: '一家旧书店的价值，不只在书架上。读者在这里发现旧书，也交换消息。理解它为何被需要，要从书的流通，看到人与社区的联系。',
  },
  {
    id: 'story', label: '故事叙事', description: '以人物和场景开篇，用变化推动叙述。',
    guidance: '开头进入素材中人物正在面对的困境、选择或行动，从处境、选择、代价到后果推进。每段带来新变化，转折须有前因和素材支持，结尾兑现开场的悬念或回应人物的选择。用具体动作呈现情绪，不堆履历，不替人物编造内心独白、对话与苦难，不强加励志升华。',
    example: '推开旧书店的门，你原本只想找一本书。翻页时，一张前任读者留下的书签滑了出来。此刻，你接过的不只是一本旧书，也是另一个人读到这里的瞬间。',
  },
  {
    id: 'commentary', label: '观点评论', description: '先亮观点，再给理由，也回应反面意见。',
    guidance: '开头提出与观众有关的一个清楚判断，随后先给最有力的事实和理由，再回应一个必要的反面意见或例外，结尾说明判断的适用边界。观点鲜明但不煽动对立；区分价值判断与事实，不用未经证实的指控、标签或“所有人都”制造冲突。',
    example: '评价旧书店，不能只问买书够不够方便。便利当然重要，但偶然发现一本书、与陌生读者交谈，同样有价值。值得讨论的是，城市愿意给这样的相遇留下多少空间。',
  },
  {
    id: 'popular-science', label: '轻松科普', description: '用生活类比解释概念，轻松但准确。',
    guidance: '用一个生活疑问或常见误解开篇，先给观众能理解的例子，再解释一个核心概念和机制；类比后补足局限，结尾留下可复述、可使用的认识。每段只推进一个知识点，解释必要术语，长句拆短，不把相关说成因果，不为段子牺牲准确性。',
    example: '旧书店为什么总能让人多逛一会儿？可以把书架想成一张没有搜索框的地图。你不是直奔答案，而是在相邻的书脊之间发现新方向。这就是偶然发现的乐趣。',
  },
  {
    id: 'data', label: '数据解读', description: '交代口径与比较对象，再说明数字的含义。',
    guidance: '开头先呈现素材里一个有意义的差异或变化，再把数字换成观众熟悉的尺度。交代来源、时间、单位、分母和比较对象，区分总量与人均、比例与百分点、名义与实际变化；用数字解释问题，再说明无法推出什么。无可靠数据时直接说明材料不足，不造统计，不用数字堆砌权威感。',
    example: '要判断旧书店是否变少，先要统一比较口径：哪座城市、哪段时间，什么样的店才算旧书店？门店数量、营业面积和到店人数回答的是不同问题，不能混作一个结论。',
  },
  {
    id: 'cultural-essay', label: '文化随笔', description: '从细节展开联想，保留余味与具体观察。',
    guidance: '从一个具体器物、动作、声音或日常场景进入，用细致观察串联个人感受与有依据的文化背景，再回到开篇的意象收束。语言有节制、有画面感，少用抽象排比和空泛抒情；不冒充亲历、不杜撰典故与引文，不强制设置冲突、反转或点赞关注。',
    example: '旧书的纸页，有一种被时间放慢的触感。折角、批注和褪色的书签，让阅读留下了痕迹。走进旧书店，像是暂时离开不断刷新的屏幕，听一听纸张保存的回声。',
  },
];

export function editorialWritingStyle(id?: string) {
  return EDITORIAL_WRITING_STYLES.find((style) => style.id === id) ?? EDITORIAL_WRITING_STYLES[0];
}
