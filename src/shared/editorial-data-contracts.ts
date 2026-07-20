import type { CustomCoverTemplate, ImageLabSmartMode, MinimaxCloneVoice } from './types';

export const IMAGE_LAB_SMART_MODE_CONTRACT = {
  'text-to-image': { label: '文生图' },
  cover: { label: '封面' },
  'blog-cover': { label: '博客封面' },
  'podcast-cover': { label: '播客封面' },
  'video-narration': { label: '旁白视频' },
  'two-host-podcast': { label: '双人播客' },
  'reference-edit': { label: '参考图编辑' },
} satisfies Record<ImageLabSmartMode, { label: string }>;

export const CUSTOM_COVER_TEMPLATE_FIELDS = {
  id: true,
  name: true,
  description: true,
  directions: true,
  compositionRule: true,
  titleLayout: true,
  subtitleLayout: true,
  plainHint: true,
  createdAt: true,
  updatedAt: true,
} satisfies { [K in keyof CustomCoverTemplate]-?: true };

export const MINIMAX_CLONE_VOICE_FIELDS = {
  voiceId: true,
  displayName: true,
  sourceAudioPath: true,
  createdAt: true,
  lastUsedAt: true,
} satisfies { [K in keyof MinimaxCloneVoice]-?: true };
