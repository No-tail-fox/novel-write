import {
  BookOpen,
  Clapperboard,
  Circle,
  Flame,
  FlaskConical,
  History,
  Images,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Mic2,
  Music,
  Play,
  Plus,
  Radar,
  Settings,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ShellView } from '../shared/types';

export interface NavigationItem {
  view: ShellView;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number }>;
}

export interface NavigationGroup {
  id: 'production' | 'asset-lab' | 'template-system';
  label: string;
  items: NavigationItem[];
}

export const newTaskPrimaryAction: NavigationItem = { view: 'new-task', label: '新建任务', hint: '素材成片', icon: Plus };

export const productionNavItems: NavigationItem[] = [
  { view: 'hot-board', label: '实时热榜', hint: '热点选题', icon: TrendingUp },
  { view: 'queue', label: '自动化队列', hint: '任务队列 · 运行与审批', icon: ListChecks },
  { view: 'history', label: '历史任务', hint: '本地记录', icon: History },
  { view: 'editorial-collage', label: 'VOX 视频', hint: '解释型视觉叙事', icon: Clapperboard },
  { view: 'motion-comic', label: 'AI 漫剧', hint: '系列与分镜', icon: Images },
  { view: 'book-selection', label: '选品助手', hint: '商品卖点', icon: BookOpen },
  { view: 'benchmark', label: '对标监控', hint: '三平台洞察', icon: Radar },
  { view: 'person-assets', label: '素材库', hint: '人物与媒体', icon: Images },
];

export const assetLabNavItems: NavigationItem[] = [
  { view: 'image-lab', label: '画图实验室', hint: '分镜图片', icon: FlaskConical },
  { view: 'voice-lab', label: '配音实验室', hint: '音色试听', icon: Mic2 },
  { view: 'music-mv', label: '音乐 MV', hint: '歌词成片', icon: Music },
  { view: 'viral-analyzer', label: '爆款拆解', hint: '拉片复刻', icon: Flame },
  { view: 'html-video', label: 'HTML 动画视频', hint: 'HTML 渲染', icon: Play },
];

export const templateSystemNavItems: NavigationItem[] = [
  { view: 'prompt-templates', label: '提示词模板', hint: '代理提示词', icon: Sparkles },
  { view: 'draft-templates', label: '模板', hint: '草稿模板 · 画布', icon: LayoutTemplate },
  { view: 'settings', label: '系统设置', hint: 'API 与路径', icon: Settings },
  { view: 'account', label: '账户中心', hint: '资料与积分', icon: Circle },
  { view: 'activation', label: '激活管理', hint: '试用与授权', icon: KeyRound },
];

export const sidebarNavGroups: NavigationGroup[] = [
  { id: 'production', label: '创作生产', items: productionNavItems },
  { id: 'asset-lab', label: '素材与实验', items: assetLabNavItems },
  { id: 'template-system', label: '模板与系统', items: templateSystemNavItems },
];

export const sidebarNavItems: NavigationItem[] = sidebarNavGroups.flatMap((group) => group.items);
export const navigationItems: NavigationItem[] = [newTaskPrimaryAction, ...sidebarNavItems];
export const taskDetailNavigationItem = { label: '任务详情', hint: '单任务流水线' } as const;

export function navigationItemForView(view: ShellView): Pick<NavigationItem, 'label' | 'hint'> {
  return view === 'task-detail'
    ? taskDetailNavigationItem
    : navigationItems.find((item) => item.view === view) ?? newTaskPrimaryAction;
}

export function taskWorkspaceView(taskType: string | null | undefined): Extract<ShellView, 'task-detail' | 'editorial-collage' | 'motion-comic' | 'html-video'> {
  if (taskType === 'html-video') return 'html-video';
  if (taskType === 'editorial-collage') return 'editorial-collage';
  if (taskType === 'motion-comic') return 'motion-comic';
  return 'task-detail';
}

export function pageSubtitle(view: ShellView): string {
  const map: Partial<Record<ShellView, string>> = {
    'new-task': '粘贴一段人物故事，几分钟后在剪映里打开',
    'hot-board': '追踪多平台实时热点，筛选后直接带入创作',
    'book-selection': '汇总对标证据与机会评分，把选品简报带入新任务',
    benchmark: '监控抖音、视频号和 B 站对标作品，筛选后进入拆解或选品',
    'person-assets': '管理本地人物真图素材，供分镜阶段保持角色一致',
    queue: '查看当前任务、步骤事件、失败重试和输出状态',
    history: '按时间浏览已完成、失败、取消和草稿任务',
    'task-detail': '查看单个任务的独立执行状态和流水线',
    'image-lab': '单独测试文生图、图像参考和分镜图片提示词',
    'voice-lab': '单独试听豆包与 MiniMax 音色，保存本地试听记录',
    'music-mv': '按歌词节奏生成音乐 MV 分镜、字幕和剪映草稿',
    'viral-analyzer': '拆解爆款短视频的开头、结构、结尾和爆点',
    'prompt-templates': '管理系统模板、克隆、导入 JSON 和本地编辑',
    'draft-templates': '调整画布、图片区域、字幕、免责声明和音频参数',
    settings: '配置 API 凭证、本地路径、TTS、IMA 与诊断',
    account: '管理本机账号资料、设备和模拟余额',
    activation: '管理本地激活状态与试用说明',
    'editorial-collage': '把文案拆成节拍、图层、运镜和字幕，先确定风格再进入生成',
    'motion-comic': '管理系列 Bible、角色造型、分集剧本、镜头引用与一致性门禁',
    'html-video': '文案、素材、配音、动画预览、封面和出片的独立 HTML 视频工作台',
  };
  return map[view] ?? '';
}
