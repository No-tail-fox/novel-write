import type { VoxTemplate } from './vox-animation';

export const SHOTCRAFT_COMMIT = '5e71af35a2daee492dd3ea93e5e8903f32dcd13c';
const upstream = `https://github.com/Vincentwei1021/video-shotcraft/blob/${SHOTCRAFT_COMMIT}`;
export interface ShotcraftRecipe {
  revision: 1;
  card: string;
  source: string;
  implementation: string;
  license: 'Apache-2.0';
  sourceFps: 30;
  supportedRatios: readonly string[];
  recommendedSeconds: number;
  minSeconds: number;
  maxTitle: number;
  maxSubtitle: number;
  maxLabel: number;
  maxDetail: number;
  maxDate: number;
  editable: readonly string[];
  motion: string;
  qaProgress: readonly number[];
}

const recipe = (card: string, implementation: string, motion: string, recommendedSeconds: number, limits: Partial<ShotcraftRecipe> = {}): ShotcraftRecipe => ({
  revision: 1, card: card.split('/').at(-1)!, source: `${upstream}/references/shots/${card}.md`,
  implementation: `${upstream}/demos/${implementation}.tsx`, license: 'Apache-2.0', sourceFps: 30,
  supportedRatios: ['16:9', '9:16', '1:1', '4:3'], recommendedSeconds, minSeconds: 3,
  maxTitle: 40, maxSubtitle: 80, maxLabel: 28, maxDetail: 60, maxDate: 24,
  editable: ['title', 'subtitle', 'accent', 'background', 'foreground', 'source', 'items', 'assetIds'],
  motion, qaProgress: [0, 0.2, 0.5, 0.8, 0.98], ...limits,
});

/** Immutable v1 additions: existing StoryDream template IDs retain their rendering. */
export const SHOTCRAFT_TEMPLATES: readonly VoxTemplate[] = [
  { id: 'shotcraft-paper-tape', name: '纸胶带定妆', category: '纸张拼贴', kind: 'paper',
    description: '卡片飘入，两条胶带拍下并压住纸面', maxImages: 1,
    recipe: recipe('ui-entrance/paper-craft-moves', 'ui-entrance/paper-craft-moves/MaskingTapeSlap',
      '悬浮→第一条胶带减震→第二条胶带同步停晃、投影收紧、下沉；两次6帧扑入，保留末段静止。所有30fps源帧按镜头实际时长映射。', 4.7,
      { maxSubtitle: 60 }) },
  { id: 'shotcraft-paper-popup', name: '折页纸卡立起', category: '纸张拼贴', kind: 'paper',
    description: '纸卡沿底边错峰立起，回弹后展开图文', items: true, maxItems: 3, maxImages: 3,
    recipe: recipe('ui-entrance/paper-craft-moves', 'ui-entrance/paper-craft-moves/PopupBookRise',
      '远排先近排后，7源帧错峰；沿底边0→-90度，damping11/stiffness130/mass0.9；根部投影不随卡片旋转。站定后留阅读时间。', 5.4,
      { maxLabel: 12, maxDetail: 24 }) },
  { id: 'shotcraft-paper-title', name: '逐词纸面压印', category: '纸张拼贴', kind: 'paper',
    description: '文字放大压印、单词强调与短划线收束', maxImages: 0,
    recipe: recipe('typography/paper-title-card', 'typography/paper-title-card/PaperTitleCard',
      '逐词scale1.28→1、blur7→0，bezier(.2,.75,.3,1)；只强调一个用户指定词。中文分词换行；完成入场后留阅读时间，尾部8源帧淡出。', 3.5,
      { maxTitle: 80, maxSubtitle: 100, minSeconds: 2, editable: ['title', 'subtitle', 'highlight', 'accent', 'background', 'foreground', 'source'] }) },
  { id: 'shotcraft-timeline-travel', name: '刻度时间轴巡游', category: '时间叙事', kind: 'timeline',
    description: '沿刻度加速前进，事件弹立，末站推近停留', items: true, maxItems: 5, maxImages: 5,
    recipe: recipe('data/timeline-travel', 'data/timeline-travel/TimelineTravel',
      '横移速度断点[0,.15,.88,1]→[0,.055,.9,1]；到站前6源帧卡片弹立；末站10源帧推近1.28倍；最终保持至少1秒静止。', 6,
      { minSeconds: 4, maxDetail: 60 }) },
  { id: 'shotcraft-source-merge', name: '来源汇聚成一体', category: '原理流程', kind: 'flow',
    description: '多路接通，来源沿曲线汇入同一节点', items: true, maxItems: 6, maxImages: 0,
    recipe: recipe('ui-entrance/bezier-source-converge-merge', 'ui-entrance/bezier-source-converge-merge/BezierSourceConvergeMerge',
      '曲线错峰draw-on；t=.34→.74沿真实贝塞尔路径汇聚；尺寸44→15→0，后25%加速吸入；数据包错相位；.78→.9收回路径，接收徽标轻脉冲。', 5.6,
      { maxLabel: 20, maxSubtitle: 24 }) },
  { id: 'shotcraft-ring-reveal', name: '环层结构注释', category: '原理流程', kind: 'flow',
    description: '主体收束成环形图，移位后逐项展开解释', items: true, maxItems: 4, maxImages: 1,
    recipe: recipe('data/ring-diagram-annotation-reveal', 'data/ring-diagram-annotation-reveal/RingDiagramAnnotationReveal',
      '主体圆窗收束→细环/分段环→12支向心箭头→整体移位缩小→注释揭示。只外环慢转，箭头不旋转；横屏左右、竖屏上下重排；最终文字静止。', 6.4,
      { minSeconds: 4, maxLabel: 16, maxDetail: 32, maxSubtitle: 24 }) },
];

export const shotcraftRecipe = (id: string) => SHOTCRAFT_TEMPLATES.find(t => t.id === id)?.recipe;
