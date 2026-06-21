const today = '2026-06-21';

export const courseCategories = ['全部', 'AI入门', 'AI漫剧', 'AI电商', 'AI内容运营', 'AI变现实践', 'OPC本地课程'];
export const resourceCategories = ['全部', '知识库', '工具导航', '模型文档', '办公提效', '电商素材', '编程建站'];

export const defaultCourses = [
  {
    id: 'opc-ai-comic-practice',
    title: 'OPC AI漫剧创作实践营',
    category: 'AI漫剧',
    track: '作品实操',
    priceType: 'free',
    priceLabel: 'OPC社区公开课',
    source: 'OPC社区',
    level: '入门到作品',
    audience: '想把小说、历史故事、产品故事做成AI漫剧的学习者',
    outcome: '完成一条60-90秒AI漫剧样片，并理解脚本、分镜、配音、剪辑协作流程。',
    syllabus: ['爆款选题与故事拆解', 'AI脚本改写与分镜', '角色一致性与画面风格', '配音、字幕与发布封面'],
    recommendation: '作为OPC社区的核心招牌课程，适合做线下活动、公众号案例和学习路线的第一站。',
    rightsNote: '仅展示课程导览、学习目标和官方报名入口，不搬运课件或视频。',
    officialUrl: 'https://www.sohu.com/a/1037945692_121106994',
    verifiedAt: today,
    status: '推荐',
  },
  {
    id: 'smartedu-ai-literacy',
    title: '国家智慧教育平台AI通识公开资源',
    category: 'AI入门',
    track: '基础认知',
    priceType: 'free',
    priceLabel: '免费公开',
    source: '国家智慧教育平台',
    level: '零基础',
    audience: '第一次系统认识生成式AI、模型能力和安全边界的普通学习者',
    outcome: '建立AI工具使用、安全合规、学习路径的基础框架。',
    syllabus: ['人工智能基础概念', '生成式AI典型应用', 'AI伦理与安全', '行业应用案例'],
    recommendation: '权威、稳妥，适合作为OPC课程站的入门前置资源。',
    rightsNote: '链接至官方公开页面，只做导览总结。',
    officialUrl: 'https://www.smartedu.cn/',
    verifiedAt: today,
    status: '推荐',
  },
  {
    id: 'higher-smartedu-ai-2026',
    title: '国家高等教育智慧教育平台 AI 2026 专区',
    category: 'AI入门',
    track: '系统学习',
    priceType: 'free',
    priceLabel: '免费公开',
    source: '国家高等教育智慧教育平台',
    level: '入门到进阶',
    audience: '希望系统补齐AI基础和高校课程资源的学习者',
    outcome: '形成从通识到专业应用的课程地图。',
    syllabus: ['人工智能基础课程', '大模型与数据智能', 'AI应用案例', '高校课程资源集合'],
    recommendation: '适合作为课程库的权威底座，增强OPC社区的学习可信度。',
    rightsNote: '仅引用官方入口和目录摘要，不复制课程正文。',
    officialUrl: 'https://higher.smartedu.cn/ai2026',
    verifiedAt: today,
    status: '推荐',
  },
  {
    id: 'xuetangx-ai-basics',
    title: '学堂在线人工智能精选课程',
    category: 'AI入门',
    track: '系统学习',
    priceType: 'free',
    priceLabel: '免费/证书可选',
    source: '学堂在线',
    level: '入门到进阶',
    audience: '想用高校课程补齐AI理论、算法和应用基础的学习者',
    outcome: '完成一条稳定的AI基础学习路径，并为工具实践打底。',
    syllabus: ['AI基础知识', '机器学习概念', '数据与模型', '行业应用'],
    recommendation: '课程覆盖面广，适合放入“继续深造”模块。',
    rightsNote: '跳转官方平台学习，本站只做课程导览。',
    officialUrl: 'https://www.xuetangx.com/',
    verifiedAt: today,
    status: '备选',
  },
  {
    id: 'icourse163-ai-channel',
    title: '中国大学MOOC人工智能课程频道',
    category: 'AI入门',
    track: '系统学习',
    priceType: 'free',
    priceLabel: '免费/证书可选',
    source: '中国大学MOOC',
    level: '入门到进阶',
    audience: '想通过高校MOOC长期学习AI基础的人群',
    outcome: '获得可持续的AI公开课清单和学习节奏。',
    syllabus: ['AI导论', 'Python与数据基础', '机器学习', 'AI应用案例'],
    recommendation: '适合做普通学习者的长期学习补充。',
    rightsNote: '仅汇总官方课程入口，不转载课程内容。',
    officialUrl: 'https://www.icourse163.org/channel/125001.htm',
    verifiedAt: today,
    status: '备选',
  },
  {
    id: 'aliyun-tianchi-ecommerce-ai',
    title: '阿里云天池AI实战与电商数据学习',
    category: 'AI电商',
    track: '作品实操',
    priceType: 'free',
    priceLabel: '免费公开',
    source: '阿里云天池',
    level: '入门到实战',
    audience: '想把AI用于商品分析、内容素材和运营效率提升的学习者',
    outcome: '理解数据、模型与电商业务结合的基础方法。',
    syllabus: ['数据分析入门', '机器学习实战', '营销与推荐案例', '云上AI工具使用'],
    recommendation: '适合作为AI电商方向的官方免费入口。',
    rightsNote: '只做官方课程导航和学习路径建议。',
    officialUrl: 'https://tianchi.aliyun.com/course/',
    verifiedAt: today,
    status: '推荐',
  },
  {
    id: 'opc-ai-ecommerce-workshop',
    title: 'OPC AI电商素材与短视频工作坊',
    category: 'AI电商',
    track: '作品实操',
    priceType: 'free',
    priceLabel: 'OPC社区公开课',
    source: 'OPC社区',
    level: '入门到作品',
    audience: '想用AI做商品主图、种草文案和短视频带货素材的学习者',
    outcome: '完成一组商品图文素材和一条短视频脚本。',
    syllabus: ['商品卖点拆解', 'AI主图与海报提示词', '短视频脚本模板', '公众号/朋友圈发布文案'],
    recommendation: '和本地商户、农特产品、社区创业主题结合度高。',
    rightsNote: '仅做OPC自有课程导览和报名入口展示，不搬运内部课件。',
    officialUrl: 'https://www.smartedu.cn/',
    verifiedAt: today,
    status: '推荐',
  },
  {
    id: 'paid-ai-commerce-candidate',
    title: '小预算AI电商训练营候选池',
    category: 'AI变现实践',
    track: '变现路径',
    priceType: 'paid',
    priceLabel: '小预算候选，需复核',
    source: 'B站课堂/网易云课堂/小鹅通等',
    level: '实操进阶',
    audience: '愿意付小额预算购买结构化陪跑的学习者',
    outcome: '在购买前完成价格、口碑、退款规则和版权授权核验。',
    syllabus: ['商品图文生成', '短视频带货流程', '私域运营', '课程购买避坑清单'],
    recommendation: '不默认推荐具体付费课，先放候选池，避免价格和质量过期。',
    rightsNote: '付费课程仅做候选导览，购买后也不搬运正文、视频或课件。',
    officialUrl: 'https://study.163.com/',
    verifiedAt: today,
    status: '待复核',
  },
];

export const defaultResources = [
  {
    id: 'waytoagi',
    name: 'WaytoAGI',
    category: '知识库',
    type: 'AI资源导航',
    scenario: '工具检索、学习路径、提示词、智能体灵感',
    audience: '想快速找到AI工具和案例的学习者',
    reason: '适合做OPC课程之外的日常工具入口，帮助学员从“听课”走向“动手找工具”。',
    officialUrl: 'https://www.waytoagi.com/',
    verifiedAt: today,
    rightsNote: '只展示站点介绍与官方跳转，不批量复制第三方内容。',
  },
  {
    id: 'aibase',
    name: 'AIBase',
    category: '工具导航',
    type: 'AI资讯与工具库',
    scenario: 'AI工具发现、行业资讯、产品观察',
    audience: '需要持续跟踪AI工具更新的学习者',
    reason: '适合补充AI资讯和工具动态，给公众号选题提供素材来源。',
    officialUrl: 'https://www.aibase.com/',
    verifiedAt: today,
    rightsNote: '仅做入口推荐和简短导览。',
  },
  {
    id: 'openai-docs',
    name: 'OpenAI 官方文档',
    category: '模型文档',
    type: '官方模型文档',
    scenario: '大模型能力、API、提示词与应用开发',
    audience: '想进一步理解模型能力或做AI应用的学习者',
    reason: '官方文档适合做高可信度的技术补充。',
    officialUrl: 'https://platform.openai.com/docs',
    verifiedAt: today,
    rightsNote: '链接官方文档，不复制大段文档内容。',
  },
  {
    id: 'doubao',
    name: '豆包',
    category: '办公提效',
    type: 'AI助手',
    scenario: '写作、总结、图片理解、日常办公',
    audience: '普通学习者和本地商户',
    reason: '上手门槛低，适合作为OPC入门课的课堂工具。',
    officialUrl: 'https://www.doubao.com/',
    verifiedAt: today,
    rightsNote: '仅推荐官方入口和使用场景。',
  },
  {
    id: 'jimeng',
    name: '即梦AI',
    category: '电商素材',
    type: '图像与视频创作工具',
    scenario: '商品图、短视频分镜、AI漫剧画面',
    audience: 'AI漫剧和AI电商方向学习者',
    reason: '适合配合OPC作品实操，做从图到视频的素材生成。',
    officialUrl: 'https://jimeng.jianying.com/',
    verifiedAt: today,
    rightsNote: '仅提供工具入口和课堂使用建议。',
  },
  {
    id: 'coze',
    name: '扣子 Coze',
    category: '编程建站',
    type: '智能体搭建平台',
    scenario: '知识库问答、客服助手、自动化工作流',
    audience: '想做AI应用和智能体的学习者',
    reason: '适合把课程成果沉淀成可演示的智能体作品。',
    officialUrl: 'https://www.coze.cn/',
    verifiedAt: today,
    rightsNote: '只做官方入口推荐。',
  },
];

export const defaultWechatTemplates = [
  {
    id: 'course-picks',
    name: '课程推荐合集',
    title: '这周从这几门AI课开始，先做出一个作品',
    opener: 'OPC社区本周整理了一组适合普通学习者的AI课程与工具入口。我们更看重能不能做出作品，而不是堆概念。',
    callToAction: '想加入线下学习和作品共创，可以联系OPC社区报名咨询。',
  },
  {
    id: 'tool-stack',
    name: '工具合集',
    title: '普通人做AI作品，先收藏这组工具入口',
    opener: 'AI学习最怕只听不练。下面这些工具和资源，适合配合OPC课程边学边做。',
    callToAction: '把你的目标告诉OPC社区，我们帮你匹配学习路线和工具组合。',
  },
  {
    id: 'activity-report',
    name: 'OPC活动报道',
    title: 'OPC社区AI学习活动回顾：从工具到作品',
    opener: '本次活动围绕AI漫剧、AI电商和内容运营展开，目标是让普通学习者完成可展示的作品。',
    callToAction: '下一期课程开放预约，欢迎持续关注OPC社区。',
  },
];

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function matchesKeyword(item, keyword, fields) {
  const needle = normalizeText(keyword);
  if (!needle) return true;
  return fields.some((field) => normalizeText(item[field]).includes(needle));
}

export function validateCourse(course) {
  const required = ['id', 'title', 'category', 'track', 'priceType', 'source', 'officialUrl', 'rightsNote', 'verifiedAt'];
  const missing = required.filter((field) => !course[field]);
  const validUrl = /^https:\/\//.test(course.officialUrl ?? '');
  const validRights = /导览|官方|不搬运|公开/.test(course.rightsNote ?? '');
  return {
    valid: missing.length === 0 && validUrl && validRights,
    errors: [
      ...missing.map((field) => `${field} is required`),
      ...(validUrl ? [] : ['officialUrl must be https']),
      ...(validRights ? [] : ['rightsNote must describe guide-only usage']),
    ],
  };
}

export function filterCourses(courses, filters = {}) {
  return courses.filter((course) => {
    const categoryOk = !filters.category || filters.category === '全部' || course.category === filters.category;
    const priceOk = !filters.priceType || filters.priceType === 'all' || course.priceType === filters.priceType;
    const trackOk = !filters.track || filters.track === '全部' || course.track === filters.track;
    const keywordOk = matchesKeyword(course, filters.keyword, ['title', 'category', 'source', 'audience', 'outcome', 'recommendation']);
    return categoryOk && priceOk && trackOk && keywordOk;
  });
}

export function filterResources(resources, filters = {}) {
  return resources.filter((resource) => {
    const categoryOk = !filters.category || filters.category === '全部' || resource.category === filters.category;
    const keywordOk = matchesKeyword(resource, filters.keyword, ['name', 'category', 'type', 'scenario', 'audience', 'reason']);
    return categoryOk && keywordOk;
  });
}

export function getDashboardStats(courses, resources) {
  return {
    courses: courses.length,
    freeCourses: courses.filter((course) => course.priceType === 'free').length,
    paidCandidates: courses.filter((course) => course.priceType === 'paid').length,
    resources: resources.length,
    localCourses: courses.filter((course) => course.source === 'OPC社区').length,
  };
}

export function buildRoutePlan(courses) {
  const stages = [
    {
      title: '入门识图',
      description: '先理解AI能做什么、不能承诺什么，建立安全边界。',
      categories: ['AI入门'],
    },
    {
      title: '工具上手',
      description: '用工具完成写作、图片、视频和资料检索的基础动作。',
      categories: ['AI内容运营', 'AI电商'],
    },
    {
      title: '作品实操',
      description: '进入OPC漫剧、电商、内容运营工作坊，做出可展示作品。',
      categories: ['AI漫剧', 'AI电商', 'OPC本地课程'],
    },
    {
      title: '传播复盘',
      description: '把作品整理成公众号、朋友圈或课程案例，沉淀下一轮选题。',
      categories: ['AI变现实践'],
    },
  ];

  return stages.map((stage) => ({
    ...stage,
    courses: courses.filter((course) => stage.categories.includes(course.category)).slice(0, 3),
  }));
}

export function generateWechatCopy(template, selectedCourses, selectedResources) {
  const courseLines = selectedCourses.map((course, index) => `${index + 1}. ${course.title}｜${course.priceLabel}\n适合：${course.audience}\n目标：${course.outcome}`);
  const resourceLines = selectedResources.map((resource, index) => `${index + 1}. ${resource.name}｜${resource.type}\n场景：${resource.scenario}\n推荐理由：${resource.reason}`);

  return [
    `# ${template.title}`,
    '',
    template.opener,
    '',
    '## 推荐课程',
    courseLines.length ? courseLines.join('\n\n') : '本期暂未选择课程。',
    '',
    '## 工具与资源',
    resourceLines.length ? resourceLines.join('\n\n') : '本期暂未选择工具资源。',
    '',
    '## OPC社区提醒',
    '本站只做课程导览、学习路径和官方入口整理，不搬运付费课程内容；AI赋能可以提升效率，但不承诺收益。',
    '',
    template.callToAction,
  ].join('\n');
}

export function loadStoredList(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredList(key, value) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}
