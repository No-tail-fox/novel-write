/** Immutable identity for a visual renderer, separate from the Jianying draft templateId. */
export const PIXELLE_REVISION = '848b054e4fae40dabc62ec58e960b573e83793ac' as const;
export interface PixelleVisualTemplateRef {
  provider: 'pixelle';
  revision: typeof PIXELLE_REVISION;
  path: string;
  sha256: string;
}
export type PixelleTemplateType = 'image' | 'static' | 'video' | 'asset';
export type PixelleTemplateValue = string | number | boolean;
export interface PixelleTemplateParameter {
  type: 'text' | 'number' | 'color' | 'bool';
  default: PixelleTemplateValue;
  label: string;
}
export interface PixelleTemplateDescriptor {
  ref: PixelleVisualTemplateRef;
  name: string;
  type: PixelleTemplateType;
  size: string;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape' | 'square';
  parameters: Record<string, PixelleTemplateParameter>;
  mediaSize: [number, number];
  remoteDependencies: string[];
}
export interface PixelleCatalog { revision: typeof PIXELLE_REVISION; templates: PixelleTemplateDescriptor[]; paidRequests: 0 }
export interface PixelleFrameResult {
  path: string;
  width: number;
  height: number;
  ref: PixelleVisualTemplateRef;
  kind: 'frame' | 'video-overlay';
  requiresVideoComposition: boolean;
  paidRequests: 0;
}
export interface PixelleRenderFrameRequest {
  mode: 'render-frame';
  workDir: string;
  templateRef: PixelleVisualTemplateRef;
  title: string;
  text: string;
  imagePath?: string;
  mediaKind?: 'image' | 'video';
  index?: number;
  output?: string;
  parameters?: Record<string, PixelleTemplateValue>;
  /** Verified local cache only; worker never downloads remote assets itself. */
  resourceMap?: Record<string, { path: string; sha256: string; contentType: string }>;
}

export interface PixelleClipResult {
  path: string;
  width: number;
  height: number;
  ref: PixelleVisualTemplateRef;
  kind: 'clip';
  durationMs: number;
  narrationDurationMs: number;
  warnings: Array<{ code: 'VIDEO_PADDING_REQUIRED'; durationMs: number; strategy: 'freeze' | 'black' }>;
  paidRequests: 0;
}
export interface PixelleRenderClipRequest extends Omit<PixelleRenderFrameRequest, 'mode'> {
  mode: 'render-clip';
  audioPath?: string;
  audioPaths?: string[];
  durationMs?: number;
  videoPath?: string;
  fps?: number;
  padStrategy?: 'freeze' | 'black';
}
export type PixelleSubtitleMode = 'template' | 'timed-overlay' | 'off';

/** Separate visual-template identity from editable Jianying draft styling. */
export interface PixelleTaskOptions {
  parameters?: Record<string, PixelleTemplateValue>;
  subtitleMode: PixelleSubtitleMode;
  mediaKind?: 'image' | 'video';
  videoPath?: string;
  padStrategy?: 'freeze' | 'black';
}

export interface PixelleVideoProbeRequest { mode: 'probe-video'; workDir: string; videoPath: string }
export interface PixelleVideoProbe { width: number; height: number; durationMs: number; paidRequests: 0 }
