import React, { useRef } from 'react';
import type { DraftTemplate, DraftTextBorder } from '../../shared/types';

export type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';

export const DRAFT_TEXT_WIDTH_MIN = 0.1;

export const DRAFT_TEXT_WIDTH_MAX = 2;

export type DraftDragSnapshot =
  | { mode: 'move'; layer: DraftCanvasLayer; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize'; layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate };

export function DraftTemplatePreview({
  template,
  compact = false,
  imageUrl,
  titleText,
  subtitleText,
  captionText,
  disclaimerText,
}: {
  template: DraftTemplate;
  compact?: boolean;
  imageUrl?: string;
  titleText?: string;
  subtitleText?: string;
  captionText?: string;
  disclaimerText?: string;
}) {
  const titleSize = draftPreviewFontSize(template.title.fontSize, compact, 0.28, 9);
  const subtitleSize = draftPreviewFontSize(template.subtitle.fontSize, compact, 0.28, 7);
  const captionSize = draftPreviewFontSize(template.caption.fontSize, compact, 0.42, 7);
  const disclaimerSize = draftPreviewFontSize(template.disclaimer.fontSize, compact, 0.42, 6);
  return (
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} data-media-canvas="draft-canvas" style={draftTemplateCanvasStyle(template)}>
      <DraftFrameChrome template={template} />
      {template.image.visible ? (
        <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%`, ...draftImageFrameStyle(template) }}>
          {imageUrl ? (
            <img
              className="draft-image-media draft-image-asset"
              data-motion={template.image.motion || 'none'}
              src={imageUrl}
              alt=""
              style={{ ...draftImageMediaStyle(template), ...draftImageMotionStyle(template), objectFit: template.image.fit }}
            />
          ) : (
            <div className="draft-image-media" data-motion={template.image.motion || 'none'} style={{ ...draftImageMediaStyle(template), ...draftImageMotionStyle(template) }} />
          )}
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasText
          className="draft-title"
          x={template.title.x}
          y={template.title.y}
          width={template.title.width}
          border={template.title.border}
          style={draftTextLayerStyle(template.title, titleSize, template.title.bold ? 800 : 500)}
        >
          {titleText ?? template.title.text}
        </DraftCanvasText>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasText
          className="draft-subtitle"
          x={template.subtitle.x}
          y={template.subtitle.y}
          width={template.subtitle.width}
          border={template.subtitle.border}
          style={draftTextLayerStyle(template.subtitle, subtitleSize, template.subtitle.bold ? 800 : 500)}
        >
          {subtitleText ?? template.subtitle.text}
        </DraftCanvasText>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasText
          className="draft-caption"
          x={template.caption.x}
          y={template.caption.y}
          width={template.caption.width}
          border={template.caption.border}
          style={{
            ...draftTextLayerStyle(template.caption, captionSize, template.caption.bold ? 700 : 500),
            backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
            borderRadius: `${template.caption.background.roundRadius * 24}px`,
            padding: compact ? '2px 8px' : '4px 10px',
          }}
        >
          {captionText ?? '字幕预览'}
        </DraftCanvasText>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasText
          className="draft-disclaimer"
          x={template.disclaimer.x}
          y={template.disclaimer.y}
          width={template.disclaimer.width}
          border={template.disclaimer.border}
          style={draftTextLayerStyle(template.disclaimer, disclaimerSize, template.disclaimer.bold ? 700 : 500)}
        >
          {disclaimerText ?? template.disclaimer.text}
        </DraftCanvasText>
      ) : null}
    </div>
  );
}

export function EditableDraftCanvas({
  template,
  selectedLayer,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasLayer;
  onSelectLayer: (layer: DraftCanvasLayer) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);

  function handleDraftCanvasPointerDown(layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'move',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    } as DraftDragSnapshot;
  }

  function handleDraftCanvasResizePointerDown(layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'resize',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 2;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 2;
    onChange(drag.mode === 'resize' ? resizeDraftLayerWidth(drag.template, drag.layer, deltaX) : updateDraftLayerPosition(drag.template, drag.layer, deltaX, deltaY));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={canvasRef}
      className="editable-draft-canvas draft-preview-large"
      data-media-canvas="draft-canvas"
      style={draftTemplateCanvasStyle(template)}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <DraftFrameChrome template={template} />
      {template.image.visible ? (
        <div
          className={selectedLayer === 'image' ? 'draft-layer image-layer selected' : 'draft-layer image-layer'}
          data-layer="image"
          style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%`, ...draftImageFrameStyle(template) }}
          onPointerDown={(event) => handleDraftCanvasPointerDown('image', event)}
        >
          <div className="draft-image-media" data-motion={template.image.motion || 'none'} style={{ ...draftImageMediaStyle(template), ...draftImageMotionStyle(template) }} />
          <span>图片区域</span>
          <i className="draft-layer-handle" />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="主标题" selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} width={template.title.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-title"
            x={0}
            y={0}
            width={1}
            border={template.title.border}
            positioned={false}
            style={draftTextLayerStyle(template.title, draftPreviewFontSize(template.title.fontSize), template.title.bold ? 800 : 500)}
          >
            {template.title.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasLayerBox layer="subtitle" label="副标题" selected={selectedLayer === 'subtitle'} x={template.subtitle.x} y={template.subtitle.y} width={template.subtitle.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-subtitle"
            x={0}
            y={0}
            width={1}
            border={template.subtitle.border}
            positioned={false}
            style={draftTextLayerStyle(template.subtitle, draftPreviewFontSize(template.subtitle.fontSize), template.subtitle.bold ? 800 : 500)}
          >
            {template.subtitle.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasLayerBox layer="caption" label="字幕" selected={selectedLayer === 'caption'} x={template.caption.x} y={template.caption.y} width={template.caption.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-caption"
            x={0}
            y={0}
            width={1}
            border={template.caption.border}
            positioned={false}
            style={{
              ...draftTextLayerStyle(template.caption, draftPreviewFontSize(template.caption.fontSize), template.caption.bold ? 700 : 500),
              backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
              borderRadius: `${template.caption.background.roundRadius * 24}px`,
              padding: '4px 10px',
            }}
          >
            字幕预览
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasLayerBox layer="disclaimer" label="免责声明" selected={selectedLayer === 'disclaimer'} x={template.disclaimer.x} y={template.disclaimer.y} width={template.disclaimer.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-disclaimer"
            x={0}
            y={0}
            width={1}
            border={template.disclaimer.border}
            positioned={false}
            style={draftTextLayerStyle(template.disclaimer, draftPreviewFontSize(template.disclaimer.fontSize), template.disclaimer.bold ? 700 : 500)}
          >
            {template.disclaimer.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
    </div>
  );
}

function DraftFrameChrome({ template }: { template: DraftTemplate }) {
  if (!template.frame.enabled) return null;
  const headerHeight = clamp(template.image.top, 0, 1) * 100;
  const footerTop = clamp(template.image.top + template.image.height, 0, 1) * 100;
  return (
    <div className="draft-frame-chrome" aria-hidden="true" data-frame-enabled="true">
      <div
        className="draft-frame-band draft-frame-header"
        style={{ height: `${headerHeight}%`, background: `linear-gradient(90deg, ${template.frame.headerColor}, ${template.frame.headerColorEnd})` }}
      />
      <div
        className="draft-frame-band draft-frame-footer"
        style={{ top: `${footerTop}%`, bottom: 0, background: `linear-gradient(90deg, ${template.frame.footerColor}, ${template.frame.footerColorEnd})` }}
      />
    </div>
  );
}

export function DraftCanvasLayerBox({
  layer,
  label,
  selected,
  x,
  y,
  width,
  onPointerDown,
  onResizePointerDown,
  children,
}: {
  layer: Exclude<DraftCanvasLayer, 'image'>;
  label: string;
  selected: boolean;
  x: number;
  y: number;
  width: number;
  onPointerDown: (layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={selected ? 'draft-layer text-layer selected' : 'draft-layer text-layer'}
      data-layer={layer}
      style={{ ...draftLayerPositionStyle(x, y), ...draftTextWidthStyle(width) }}
      onPointerDown={(event) => onPointerDown(layer, event)}
    >
      <span>{label}</span>
      {children}
      <i className="draft-layer-handle" onPointerDown={(event) => onResizePointerDown(layer, event)} />
    </div>
  );
}

export function DraftCanvasText({
  className,
  x,
  y,
  width,
  border,
  positioned = true,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  width: number;
  border?: DraftTextBorder;
  positioned?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const positionStyle = positioned ? draftLayerPositionStyle(x, y) : {};
  return (
    <div className={className} style={{ ...positionStyle, ...draftTextWidthStyle(width), ...draftTextStrokeStyle(border), ...style }}>
      {children}
    </div>
  );
}

export function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return applyDraftImageRatio({ ...template, canvas: { ...template.canvas, ...canvas, ratio } }, template.image.ratio);
}

export function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const height = clamp(draftImageHeightForCanvas(template.canvas, ratio), 0.1, 1);
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      height,
      top: clamp((1 - height) / 2, -0.2, 1 - Math.min(0.1, height)),
    },
  };
}

export function draftImageHeightForCanvas(canvas: DraftTemplate['canvas'], imageRatio: string): number {
  const ratio = ratioToNumber(imageRatio);
  if (!ratio) return 1;
  return (canvas.width / ratio) / canvas.height;
}

export function draftTemplateCanvasStyle(template: DraftTemplate): React.CSSProperties {
  const backgroundImage = template.canvas.backgroundImage.trim();
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    '--draft-preview-width': `${draftPreviewWidth(template)}px`,
    '--draft-canvas-ratio': ratio,
    aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
    backgroundColor: template.canvas.backgroundColor,
    backgroundImage: backgroundImage ? `url("${toLocalImageUrl(backgroundImage).replace(/"/g, '\\"')}")` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
  };
  return style;
}

export function draftPreviewWidth(template: DraftTemplate): number {
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  if (ratio >= 1.5) return 640;
  if (ratio >= 1.2) return 560;
  if (ratio >= 0.95) return 520;
  return Math.max(300, Math.round(ratio * 560));
}

export function draftImageMediaStyle(template: DraftTemplate): React.CSSProperties {
  const aspectRatio = draftImageAspectRatio(template.image.ratio);
  if (template.image.fit === 'contain') {
    return {
      aspectRatio,
      height: 'auto',
      maxHeight: '100%',
      maxWidth: '100%',
      width: '100%',
    };
  }
  return {
    aspectRatio,
    height: '100%',
    width: '100%',
  };
}

export function draftImageMotionStyle(template: DraftTemplate): React.CSSProperties {
  const { motion, motionStrength } = template.image;
  if (!motion) return {};
  const style = {
    '--draft-motion-scale': 1 + 0.08 * clamp(motionStrength, 0.5, 2),
    '--draft-motion-pan': `${4 * clamp(motionStrength, 0.5, 2)}%`,
    animationName: `draft-motion-${motion}`,
    animationDuration: `${Math.max(4, 8 / clamp(motionStrength, 0.5, 2))}s`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    transformOrigin: 'center',
    willChange: 'transform',
  } as React.CSSProperties & Record<string, string | number>;
  return style;
}

export function draftImageFrameStyle(template: DraftTemplate): React.CSSProperties {
  if (!template.frame.enabled || template.frame.imageBorderWidth <= 0) return {};
  const width = Math.min(16, template.frame.imageBorderWidth / 8);
  const border = `${width}px solid ${template.frame.imageBorderColor}`;
  if (template.frame.imageBorderSides === 'horizontal') {
    return { borderTop: border, borderBottom: border, boxSizing: 'border-box' };
  }
  if (template.frame.imageBorderSides === 'vertical') {
    return { borderLeft: border, borderRight: border, boxSizing: 'border-box' };
  }
  return { border, boxSizing: 'border-box' };
}

export function draftImageAspectRatio(ratio: string): string {
  const parts = ratio.split(':').map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '9 / 16';
}

export function ratioToNumber(ratio: string): number {
  const [width, height] = ratio.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

export function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}

export function colorWithAlpha(color: string, alpha: number): string {
  const normalized = normalizeColorInput(color).slice(1);
  const channel = (offset: number) => Number.parseInt(normalized.slice(offset, offset + 2), 16);
  const opacity = clamp(alpha, 0, 1);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${opacity})`;
}

export function draftTextStrokeStyle(border?: DraftTextBorder): React.CSSProperties {
  if (!border || border.width <= 0 || border.alpha <= 0) return {};
  const color = colorWithAlpha(border.color, border.alpha);
  const previewStrokeWidth = `clamp(1px, ${Number((border.width / 50).toFixed(4))}cqw, 4px)`;
  return {
    WebkitTextStroke: `${previewStrokeWidth} ${color}`,
    paintOrder: 'stroke fill',
    textShadow: `0 1px 2px ${colorWithAlpha(border.color, Math.min(border.alpha, 0.55))}`,
  };
}

export function draftTextLayerStyle(
  text: Pick<DraftTemplate['title'], 'color' | 'alpha' | 'underline' | 'align' | 'letterSpacing' | 'lineSpacing'>,
  fontSize: React.CSSProperties['fontSize'],
  fontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties {
  return {
    color: text.color,
    fontSize,
    opacity: text.alpha,
    fontWeight,
    textDecorationLine: text.underline ? 'underline' : 'none',
    textDecorationColor: text.color,
    textDecorationStyle: 'solid',
    textDecorationThickness: '0.09em',
    textUnderlineOffset: '0.13em',
    textDecorationSkipInk: 'none',
    textAlign: draftTextAlign(text.align),
    letterSpacing: `${text.letterSpacing}px`,
    lineHeight: `${1 + text.lineSpacing / 10}`,
  };
}

export function draftPreviewFontSize(fontSize: number, compact = false, compactScale = 0.28, compactMinimum = 7): React.CSSProperties['fontSize'] {
  if (compact) return Math.max(compactMinimum, fontSize * compactScale);
  return `${Number((fontSize / 1.8).toFixed(4))}cqw`;
}

export function draftTextWidthStyle(width: number): React.CSSProperties {
  return {
    width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`,
  };
}

export function draftTextAlign(align: number): React.CSSProperties['textAlign'] {
  if (align <= 0) return 'left';
  if (align >= 2) return 'right';
  return 'center';
}

export function isDraftLayerVisible(template: DraftTemplate, layer: DraftCanvasLayer): boolean {
  if (layer === 'image') return template.image.visible;
  if (layer === 'title') return template.title.visible;
  if (layer === 'subtitle') return template.subtitle.visible;
  if (layer === 'caption') return template.caption.visible;
  return template.disclaimer.visible;
}

export function firstVisibleDraftLayer(template: DraftTemplate): DraftCanvasLayer {
  return (['image', 'title', 'subtitle', 'caption', 'disclaimer'] as DraftCanvasLayer[]).find((layer) => isDraftLayerVisible(template, layer)) ?? 'title';
}

export function updateDraftLayerPosition(template: DraftTemplate, layer: DraftCanvasLayer, deltaX: number, deltaY: number): DraftTemplate {
  if (layer === 'image') {
    return {
      ...template,
      image: {
        ...template.image,
        top: clamp(template.image.top + deltaY / 2, -0.2, 1 - Math.min(0.1, template.image.height)),
      },
    };
  }
  if (layer === 'title') {
    return { ...template, title: { ...template.title, x: clamp(template.title.x + deltaX, -0.9, 0.9), y: clamp(template.title.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'subtitle') {
    return { ...template, subtitle: { ...template.subtitle, x: clamp(template.subtitle.x + deltaX, -0.9, 0.9), y: clamp(template.subtitle.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'caption') {
    return { ...template, caption: { ...template.caption, x: clamp(template.caption.x + deltaX, -0.9, 0.9), y: clamp(template.caption.y + deltaY, -0.9, 0.9) } };
  }
  return { ...template, disclaimer: { ...template.disclaimer, x: clamp(template.disclaimer.x + deltaX, -0.9, 0.9), y: clamp(template.disclaimer.y + deltaY, -0.95, 0.95) } };
}

export function resizeDraftLayerWidth(template: DraftTemplate, layer: Exclude<DraftCanvasLayer, 'image'>, deltaX: number): DraftTemplate {
  if (layer === 'title') return { ...template, title: { ...template.title, width: clamp(template.title.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'subtitle') return { ...template, subtitle: { ...template.subtitle, width: clamp(template.subtitle.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'caption') return { ...template, caption: { ...template.caption, width: clamp(template.caption.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  return { ...template, disclaimer: { ...template.disclaimer, width: clamp(template.disclaimer.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
}

export function draftLayerPositionStyle(x: number, y: number): React.CSSProperties {
  return {
    left: `${((x + 1) / 2) * 100}%`,
    top: `${((y + 1) / 2) * 100}%`,
    transform: 'translate(-50%, -50%)',
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

export function cloneDraftTemplate(template: DraftTemplate): DraftTemplate {
  return JSON.parse(JSON.stringify(template)) as DraftTemplate;
}
