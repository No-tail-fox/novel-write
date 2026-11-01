import { workflowPrompt } from '../workflow-prompt-runtime';
import catalog from './lemo-catalog.json';
import { CREATIVE_ADAPTERS } from './adapters';

export const LEMO_REVISION = '3961ddb3d24d8876e0e2754f7790d66908acee51';
export const CREATIVE_ADAPTER_REVISION = 2;
const descriptions: Record<string, string> = {
  'halftone-dossier': '米色纸张、半调网点与证据标记，逐条揭示观点。',
  'archive-lighttable': '以真实档案为中心，保留出处，用缓慢镜头突出证据。',
  dataviz: '以准确图表解释数据，随旁白强调当前数值，保留单位和来源。',
  'swiss-motion': '网格排版、清晰留白与红色强调，用文字和图形表达关系。',
  'dark-keynote': '深色舞台、大字与克制的聚光，每段聚焦一个核心观点。',
  'paper-popup': '纸张折叠、层次和柔和阴影，以立体纸景展开叙述。',
  'caption-news': '大字新闻、照片与黄色关键词，随旁白分段揭示。',
  newsreel: '黑白新闻胶片、报刊与年代卡，保留档案质感。',
  countdown: '多画面分屏与倒计时，按事件节点展开、合并。',
  'city-symphony': '城市光线与建筑节奏，以图片组接表现时间变化。',
  'visual-investigation': '冻结、裁切和比对真实资料，逐步揭示调查发现。',
  'kino-montage': '黑白剪影、红色斜线和强烈方向，构成蒙太奇。',
  telestrator: '停帧、圈线与箭头，解释当前画面的关键关系。',
  'news-package': '统一新闻条、翻牌和字幕包装，每帧突出一个事实。',
  'satellite-briefing': '俯视影像、逐级推近与细线标注，解释空间关系。',
  'briefing-board': '白板、钉图与关系连线，逐步拼出完整说明。',
  'lidar-survey': '暗色点云、扫描与剖面，使用图片和二维图形适配。',
  'white-model': '白色建筑模型与投影色层，逐层解释概念。',
  'data-physical': '用可数的实体堆叠表现真实数据和比例。',
  teardown: '工程部件沿轴分离、重组，突出结构关系。',
  microscope: '显微图片、局部聚焦和细线标注，观察一个细节。',
  'crayon-book': '蜡笔排线、暖纸与有限姿态，呈现绘本质感。',
  watercolor: '透明水彩、积色边缘和纸白，缓慢展开画面。',
  'ink-wash': '墨色浓淡、飞白与留白，以疏密和停顿叙事。',
  impasto: '厚涂笔触与冷暖明暗，保持清楚的主体轮廓。',
  'one-line': '连续轮廓线逐步绘出关系，少量色块突出重点。',
  whiteboard: '白板线稿、关系箭头和擦写，跟随解释推进。',
  'urban-sketch': '棕色钢笔轮廓与局部水彩，保留城市速写留白。',
  'shadow-puppet': '背光皮影、镂空与关节姿态，形成平面戏台。',
  ukiyoe: '木版平涂、墨线与普鲁士蓝，以横向卷轴展开。',
  'papercut-red': '朱红连体剪纸与米色留白，逐层揭示镂空图案。',
  'paper-lantern': '深蓝纸剧场与暖色透光，分层视差引向亮处。',
  risograph: '专色油墨、套印偏移与纸张颗粒，分版落印。',
  woodcut: '黑色木刻、刻痕与强轮廓，按方向揭示画面。',
  engraving: '细密铜版排线与矿物淡彩，缓慢检视局部。',
  'silkscreen-poster': '少量平涂专色与清晰远近层，形成丝网海报。',
  'spy-titles': '剪影、文字窗口和红黑构图，形成谍战片头节奏。',
  'art-deco': '黑金轴对称、阶梯几何与缓慢展开。',
  blueprint: '靛蓝底稿、技术线与引线，按构造顺序绘制。',
  'stained-glass': '深色铅线分割彩色玻璃，分区点亮画面。',
  'pictogram-motion': '统一网格的平面象形图，按意义变换和对齐。',
  'ascii-crt': '等宽字符与单色荧光，按字符网格扫描、更新。',
  'iso-infographic': '等距物件和空间连线，依次构建解释链条。',
  'living-screencast': '真实产品截图、局部聚焦与指针，解释可见操作。',
  'hologram-hud': '冷色仪表、扫描与锁定，每段只突出一个读数。',
  'rubber-hose': '黑白橡皮管角色与有限姿态，强调蓄力和跟随。',
  'cel-anime-80s': '双色赛璐璐角色、靛蓝夜景和霓虹强调。',
  'scifi-toon': '粗轮廓、少量平涂和夸张反应，原创科幻卡通。',
  'midcentury-toon': '复古几何场景、错版色块与简练角色动作。',
  'pixel-rpg': '低分辨率像素场景、整数位移与逐帧姿态。',
  'hd-2d': '像素角色、分层景深与冷雾暖灯，缓慢视差运动。',
  microgame: '一个清楚的街机动作，依次展示指令、行动和结果。',
  'game-show': '糖果色演播室、问题与答案揭示，强调阅读停顿。',
  'silent-film': '黑白默片、字幕卡与光圈转场，保留放映质感。',
  backrooms: '空旷黄褐空间、重复建筑与缓慢不安的镜头。',
  'brick-toy': '通用积木、可见拼接与定格组装，保留接触感。',
  'tilt-shift': '高角度微缩景观、窄焦带与克制的定格运动。',
  'lowpoly-island': '粉彩低多边形小世界，分件组装和二维景深。',
  'glass-product': '黑底玻璃静物、冷色轮廓光与缓慢扫光。',
};
export const CREATIVE_STYLES = catalog.map(style => ({ ...style, description: descriptions[style.slug] ?? style.category_cn, readiness: CREATIVE_ADAPTERS[style.slug] ? 'adapted' as const : 'collected' as const, adapter: CREATIVE_ADAPTERS[style.slug] }));
export function creativeStyle(slug: string) {
  const style = CREATIVE_STYLES.find(style => style.slug === slug);
  if (!style?.adapter) return style;
  const imageDirection = workflowPrompt("creative-image:" + slug, style.adapter.imageDirection);
  const motionDirection = workflowPrompt("creative-motion:" + slug, style.adapter.motionDirection);
  return { ...style, adapter: { ...style.adapter, imageDirection, motionDirection,
    direction: `Material and composition: ${imageDirection}
Motion grammar: ${motionDirection}` } };
}
export function resolveCreativeStyle(styleId: string | undefined, presetId: string) {
  return creativeStyle(!styleId || styleId === 'auto' ? presetId === 'data-map' ? 'dataviz' : presetId === 'archival-story' ? 'archive-lighttable' : 'halftone-dossier' : styleId);
}
