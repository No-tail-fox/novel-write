import React, { useRef } from 'react';
import type { DraftTemplate, DraftTextBorder } from '../../shared/types';
import { draftFontCssFamily } from '../../shared/templates';

export type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';
export type DraftImageEditTarget = 'image-frame' | 'image-media';
export type DraftCanvasSelection = DraftImageEditTarget | Exclude<DraftCanvasLayer, 'image'>;
export type DraftResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface DraftCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DraftImageAnimationPreviewKind =
  | 'none'
  | 'zoom'
  | 'shrink'
  | 'slide-left'
  | 'slide-right'
  | 'slide-shrink-left'
  | 'slide-shrink-right'
  | 'rise'
  | 'drop'
  | 'drop-left'
  | 'drop-right'
  | 'spin'
  | 'spin-rise'
  | 'spin-drop'
  | 'spin-shrink'
  | 'spin-out'
  | 'flip'
  | 'split'
  | 'bounce'
  | 'sway'
  | 'wave'
  | 'stretch';

export const DRAFT_TEXT_WIDTH_MIN = 0.1;

export const DRAFT_TEXT_WIDTH_MAX = 2;
export const DRAFT_IMAGE_FRAME_MIN = 0.08;
export const DRAFT_IMAGE_SCALE_MAX = 8;

const draftResizeHandles: DraftResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const draftResizeHandleLabels: Record<DraftResizeHandle, string> = {
  n: '上边',
  ne: '右上角',
  e: '右边',
  se: '右下角',
  s: '下边',
  sw: '左下角',
  w: '左边',
  nw: '左上角',
};

export type DraftDragSnapshot =
  | { mode: 'move'; selection: DraftCanvasSelection; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize-text'; layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize-image'; target: DraftImageEditTarget; handle: DraftResizeHandle; pointerId: number; startX: number; startY: number; template: DraftTemplate };

export function draftCanvasSelectionLayer(selection: DraftCanvasSelection): DraftCanvasLayer {
  return selection === 'image-frame' || selection === 'image-media' ? 'image' : selection;
}

export function isDraftCanvasSelectionVisible(template: DraftTemplate, selection: DraftCanvasSelection): boolean {
  if (selection === 'image-media') return template.image.visible && template.image.fit === 'cover';
  return isDraftLayerVisible(template, draftCanvasSelectionLayer(selection));
}

export function firstVisibleDraftCanvasSelection(template: DraftTemplate): DraftCanvasSelection {
  const layer = firstVisibleDraftLayer(template);
  return layer === 'image' ? 'image-frame' : layer;
}

export function draftImageFrameRect(template: DraftTemplate): DraftCanvasRect {
  const width = clamp(template.image.width, 0, 1);
  const height = clamp(template.image.height, 0, 1);
  return {
    left: clamp(template.image.left, 0, Math.max(0, 1 - width)),
    top: clamp(template.image.top, 0, Math.max(0, 1 - height)),
    width,
    height,
  };
}

export function draftImageMediaRect(template: DraftTemplate): DraftCanvasRect {
  const frame = draftImageFrameRect(template);
  if (template.image.fit === 'contain' || frame.width <= 0 || frame.height <= 0) return frame;
  const base = draftImageBaseMediaSize(template, frame);
  const scale = clamp(template.image.mediaScale, 1, DRAFT_IMAGE_SCALE_MAX);
  const width = base.width * scale;
  const height = base.height * scale;
  const overflowX = Math.max(0, width - frame.width);
  const overflowY = Math.max(0, height - frame.height);
  const centerX = frame.left + frame.width / 2 + overflowX * (0.5 - clamp(template.image.focusX, 0, 1));
  const centerY = frame.top + frame.height / 2 + overflowY * (0.5 - clamp(template.image.focusY, 0, 1));
  return { left: centerX - width / 2, top: centerY - height / 2, width, height };
}

export function moveDraftImageFrame(template: DraftTemplate, deltaX: number, deltaY: number): DraftTemplate {
  const frame = draftImageFrameRect(template);
  return applyDraftImageFrameRect(template, {
    ...frame,
    left: clamp(frame.left + deltaX, 0, 1 - frame.width),
    top: clamp(frame.top + deltaY, 0, 1 - frame.height),
  });
}

export function resizeDraftImageFrame(template: DraftTemplate, handle: DraftResizeHandle, deltaX: number, deltaY: number): DraftTemplate {
  const frame = draftImageFrameRect(template);
  let left = frame.left;
  let top = frame.top;
  let right = frame.left + frame.width;
  let bottom = frame.top + frame.height;
  if (handle.includes('w')) left = clamp(left + deltaX, 0, right - DRAFT_IMAGE_FRAME_MIN);
  if (handle.includes('e')) right = clamp(right + deltaX, left + DRAFT_IMAGE_FRAME_MIN, 1);
  if (handle.includes('n')) top = clamp(top + deltaY, 0, bottom - DRAFT_IMAGE_FRAME_MIN);
  if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + DRAFT_IMAGE_FRAME_MIN, 1);
  return applyDraftImageFrameRect(template, { left, top, width: right - left, height: bottom - top });
}

export function updateDraftImageFrameRect(template: DraftTemplate, patch: Partial<DraftCanvasRect>): DraftTemplate {
  return applyDraftImageFrameRect(template, { ...draftImageFrameRect(template), ...patch });
}

export function moveDraftImageMedia(template: DraftTemplate, deltaX: number, deltaY: number): DraftTemplate {
  if (template.image.fit !== 'cover') return template;
  const media = draftImageMediaRect(template);
  return applyDraftImageMediaRect(template, { ...media, left: media.left + deltaX, top: media.top + deltaY });
}

export function resizeDraftImageMedia(template: DraftTemplate, handle: DraftResizeHandle, deltaX: number, deltaY: number): DraftTemplate {
  if (template.image.fit !== 'cover') return template;
  const media = draftImageMediaRect(template);
  if (media.width <= 0 || media.height <= 0) return template;
  const horizontalFactor = handle.includes('e')
    ? (media.width + deltaX) / media.width
    : handle.includes('w')
      ? (media.width - deltaX) / media.width
      : 1;
  const verticalFactor = handle.includes('s')
    ? (media.height + deltaY) / media.height
    : handle.includes('n')
      ? (media.height - deltaY) / media.height
      : 1;
  const factor = handle.length === 2
    ? (Math.abs(horizontalFactor - 1) >= Math.abs(verticalFactor - 1) ? horizontalFactor : verticalFactor)
    : (handle === 'e' || handle === 'w' ? horizontalFactor : verticalFactor);
  const scale = clamp(template.image.mediaScale * Math.max(0.01, factor), 1, DRAFT_IMAGE_SCALE_MAX);
  const scaleRatio = scale / clamp(template.image.mediaScale, 1, DRAFT_IMAGE_SCALE_MAX);
  const width = media.width * scaleRatio;
  const height = media.height * scaleRatio;
  const centerX = handle.includes('w')
    ? media.left + media.width - width / 2
    : handle.includes('e')
      ? media.left + width / 2
      : media.left + media.width / 2;
  const centerY = handle.includes('n')
    ? media.top + media.height - height / 2
    : handle.includes('s')
      ? media.top + height / 2
      : media.top + media.height / 2;
  return applyDraftImageMediaRect(template, { left: centerX - width / 2, top: centerY - height / 2, width, height });
}

export function updateDraftImageMediaScale(template: DraftTemplate, mediaScale: number): DraftTemplate {
  if (template.image.fit !== 'cover') return template;
  const media = draftImageMediaRect(template);
  const currentScale = clamp(template.image.mediaScale, 1, DRAFT_IMAGE_SCALE_MAX);
  const nextScale = clamp(mediaScale, 1, DRAFT_IMAGE_SCALE_MAX);
  const factor = nextScale / currentScale;
  const width = media.width * factor;
  const height = media.height * factor;
  const centerX = media.left + media.width / 2;
  const centerY = media.top + media.height / 2;
  return applyDraftImageMediaRect(template, { left: centerX - width / 2, top: centerY - height / 2, width, height });
}

function applyDraftImageFrameRect(template: DraftTemplate, nextFrame: DraftCanvasRect): DraftTemplate {
  const previousMedia = draftImageMediaRect(template);
  const width = clamp(nextFrame.width, DRAFT_IMAGE_FRAME_MIN, 1);
  const height = clamp(nextFrame.height, DRAFT_IMAGE_FRAME_MIN, 1);
  const frame = {
    left: clamp(nextFrame.left, 0, 1 - width),
    top: clamp(nextFrame.top, 0, 1 - height),
    width,
    height,
  };
  const next = { ...template, image: { ...template.image, ...frame } };
  return template.image.fit === 'cover' ? applyDraftImageMediaRect(next, previousMedia) : next;
}

function applyDraftImageMediaRect(template: DraftTemplate, desired: DraftCanvasRect): DraftTemplate {
  const frame = draftImageFrameRect(template);
  const base = draftImageBaseMediaSize(template, frame);
  if (base.width <= 0 || base.height <= 0) return template;
  const requestedScale = Math.max(desired.width / base.width, desired.height / base.height, 1);
  const mediaScale = clamp(requestedScale, 1, DRAFT_IMAGE_SCALE_MAX);
  const width = base.width * mediaScale;
  const height = base.height * mediaScale;
  const desiredCenterX = desired.left + desired.width / 2;
  const desiredCenterY = desired.top + desired.height / 2;
  const centerX = clamp(desiredCenterX, frame.left + frame.width - width / 2, frame.left + width / 2);
  const centerY = clamp(desiredCenterY, frame.top + frame.height - height / 2, frame.top + height / 2);
  const overflowX = Math.max(0, width - frame.width);
  const overflowY = Math.max(0, height - frame.height);
  const focusX = overflowX > 1e-8 ? clamp(0.5 - (centerX - frame.left - frame.width / 2) / overflowX, 0, 1) : 0.5;
  const focusY = overflowY > 1e-8 ? clamp(0.5 - (centerY - frame.top - frame.height / 2) / overflowY, 0, 1) : 0.5;
  return { ...template, image: { ...template.image, mediaScale, focusX, focusY } };
}

function draftImageBaseMediaSize(template: DraftTemplate, frame: DraftCanvasRect): Pick<DraftCanvasRect, 'width' | 'height'> {
  if (frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 };
  const canvasWidth = Math.max(1, template.canvas.width);
  const canvasHeight = Math.max(1, template.canvas.height);
  const imageRatio = ratioToNumber(template.image.ratio) || canvasWidth / canvasHeight;
  const frameRatio = (frame.width * canvasWidth) / (frame.height * canvasHeight);
  if (imageRatio >= frameRatio) {
    return { width: (frame.height * canvasHeight * imageRatio) / canvasWidth, height: frame.height };
  }
  return { width: frame.width, height: (frame.width * canvasWidth) / (imageRatio * canvasHeight) };
}

export function DraftTemplatePreview({
  template,
  compact = false,
  imageUrl,
  videoUrl,
  titleText,
  subtitleText,
  captionText,
  disclaimerText,
}: {
  template: DraftTemplate;
  compact?: boolean;
  imageUrl?: string;
  videoUrl?: string;
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
        <div className="draft-image" style={{ ...draftImageFramePositionStyle(template), ...draftImageFrameStyle(template) }}>
          {videoUrl ? (
            <video
              className="draft-image-media draft-image-asset"
              src={videoUrl}
              muted
              playsInline
              autoPlay
              loop
              aria-label="分镜视频预览"
              style={draftCenteredMediaStyle(template.image.fit)}
            />
          ) : imageUrl ? (
            <img
              className="draft-image-media draft-image-asset"
              data-motion={template.image.motion || 'none'}
              src={imageUrl}
              alt=""
              style={{ ...draftImageMediaStyle(template), ...draftImageMotionStyle(template) }}
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
          underline={template.title.underline}
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
          underline={template.subtitle.underline}
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
          underline={template.caption.underline}
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
          underline={template.disclaimer.underline}
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
  animationPreview = null,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasSelection;
  animationPreview?: string | null;
  onSelectLayer: (layer: DraftCanvasSelection) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);
  const frameRect = draftImageFrameRect(template);
  const mediaRect = draftImageMediaRect(template);

  function handleDraftCanvasPointerDown(selection: DraftCanvasSelection, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(selection);
    dragRef.current = {
      mode: 'move',
      selection,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handleDraftCanvasResizePointerDown(layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'resize-text',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handleDraftImageResizePointerDown(target: DraftImageEditTarget, handle: DraftResizeHandle, event: React.PointerEvent<HTMLButtonElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(target);
    dragRef.current = {
      mode: 'resize-image',
      target,
      handle,
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
    const deltaX = (event.clientX - drag.startX) / rect.width;
    const deltaY = (event.clientY - drag.startY) / rect.height;
    if (drag.mode === 'resize-image') {
      onChange(drag.target === 'image-frame'
        ? resizeDraftImageFrame(drag.template, drag.handle, deltaX, deltaY)
        : resizeDraftImageMedia(drag.template, drag.handle, deltaX, deltaY));
      return;
    }
    if (drag.mode === 'resize-text') {
      onChange(resizeDraftLayerWidth(drag.template, drag.layer, deltaX * 2));
      return;
    }
    if (drag.selection === 'image-frame') {
      onChange(moveDraftImageFrame(drag.template, deltaX, deltaY));
      return;
    }
    if (drag.selection === 'image-media') {
      onChange(moveDraftImageMedia(drag.template, deltaX, deltaY));
      return;
    }
    onChange(updateDraftLayerPosition(drag.template, drag.selection, deltaX * 2, deltaY * 2));
  }

  function handleImageSelectionKeyDown(target: DraftImageEditTarget, event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectLayer(target);
      return;
    }
    const delta = event.shiftKey ? 0.02 : 0.005;
    const deltaX = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
    const deltaY = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
    if (!deltaX && !deltaY) return;
    event.preventDefault();
    onSelectLayer(target);
    onChange(target === 'image-frame' ? moveDraftImageFrame(template, deltaX, deltaY) : moveDraftImageMedia(template, deltaX, deltaY));
  }

  function handleImageResizeKeyDown(target: DraftImageEditTarget, handle: DraftResizeHandle, event: React.KeyboardEvent<HTMLButtonElement>) {
    const delta = event.shiftKey ? 0.02 : 0.005;
    const deltaX = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
    const deltaY = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
    if (!deltaX && !deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(target);
    onChange(target === 'image-frame'
      ? resizeDraftImageFrame(template, handle, deltaX, deltaY)
      : resizeDraftImageMedia(template, handle, deltaX, deltaY));
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
        <>
          <div
            key={animationPreview ? `image-preview-${animationPreview}` : 'image-layer'}
            className="draft-image draft-image-edit-clip image-layer"
            data-animation-preview={draftImageAnimationPreviewKind(animationPreview)}
            style={{ ...draftRectStyle(frameRect), ...draftImageFrameStyle(template) }}
          >
            <div className="draft-image-media" data-motion={template.image.motion || 'none'} style={{ ...draftImageMediaStyle(template), ...draftImageMotionStyle(template) }} />
          </div>
          <DraftImageTransformBox
            target="image-frame"
            label="图片展示框"
            rect={frameRect}
            selected={selectedLayer === 'image-frame'}
            onPointerDown={handleDraftCanvasPointerDown}
            onKeyDown={handleImageSelectionKeyDown}
            onResizePointerDown={handleDraftImageResizePointerDown}
            onResizeKeyDown={handleImageResizeKeyDown}
          />
          {template.image.fit === 'cover' ? (
            <DraftImageTransformBox
              target="image-media"
              label="实际图片"
              rect={mediaRect}
              selected={selectedLayer === 'image-media'}
              onPointerDown={handleDraftCanvasPointerDown}
              onKeyDown={handleImageSelectionKeyDown}
              onResizePointerDown={handleDraftImageResizePointerDown}
              onResizeKeyDown={handleImageResizeKeyDown}
            />
          ) : null}
        </>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="主标题" selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} width={template.title.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-title"
            x={0}
            y={0}
            width={1}
            border={template.title.border}
            underline={template.title.underline}
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
            underline={template.subtitle.underline}
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
            underline={template.caption.underline}
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
            underline={template.disclaimer.underline}
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

function DraftImageTransformBox({
  target,
  label,
  rect,
  selected,
  onPointerDown,
  onKeyDown,
  onResizePointerDown,
  onResizeKeyDown,
}: {
  target: DraftImageEditTarget;
  label: string;
  rect: DraftCanvasRect;
  selected: boolean;
  onPointerDown: (target: DraftImageEditTarget, event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (target: DraftImageEditTarget, event: React.KeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (target: DraftImageEditTarget, handle: DraftResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown: (target: DraftImageEditTarget, handle: DraftResizeHandle, event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={`draft-image-transform-box ${target} ${selected ? 'selected' : ''}`}
      data-layer={target}
      data-selected={selected ? 'true' : 'false'}
      style={draftRectStyle(rect)}
      role={selected ? 'button' : undefined}
      tabIndex={selected ? 0 : -1}
      aria-label={selected ? `${label}，方向键移动` : undefined}
      onPointerDown={(event) => onPointerDown(target, event)}
      onKeyDown={(event) => onKeyDown(target, event)}
    >
      <span>{label}</span>
      {selected ? draftResizeHandles.map((handle) => (
        <button
          key={handle}
          type="button"
          className="draft-transform-handle"
          data-resize-handle={handle}
          aria-label={`${label}${draftResizeHandleLabels[handle]}缩放`}
          onPointerDown={(event) => onResizePointerDown(target, handle, event)}
          onKeyDown={(event) => onResizeKeyDown(target, handle, event)}
        />
      )) : null}
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
  onPointerDown: (layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLDivElement>) => void;
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
  underline = false,
  positioned = true,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  width: number;
  border?: DraftTextBorder;
  underline?: boolean;
  positioned?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const positionStyle = positioned ? draftLayerPositionStyle(x, y) : {};
  return (
    <div
      className={className}
      data-draft-underline={underline ? 'on' : 'off'}
      style={{ ...positionStyle, ...draftTextWidthStyle(width), ...draftTextStrokeStyle(border), ...style }}
    >
      <span className={underline ? 'draft-text-content underlined' : 'draft-text-content'}>{children}</span>
    </div>
  );
}

export function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return { ...template, canvas: { ...template.canvas, ...canvas, ratio } };
}

export function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      focusX: 0.5,
      focusY: 0.5,
      mediaScale: 1,
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
  if (template.image.fit === 'contain') {
    return draftCenteredMediaStyle('contain');
  }
  const frame = draftImageFrameRect(template);
  const media = draftImageMediaRect(template);
  if (frame.width <= 0 || frame.height <= 0) return { display: 'none' };
  return {
    left: `${((media.left - frame.left) / frame.width) * 100}%`,
    top: `${((media.top - frame.top) / frame.height) * 100}%`,
    width: `${(media.width / frame.width) * 100}%`,
    height: `${(media.height / frame.height) * 100}%`,
    objectFit: 'cover',
  };
}

function draftCenteredMediaStyle(fit: DraftTemplate['image']['fit']): React.CSSProperties {
  return { inset: 0, width: '100%', height: '100%', objectFit: fit, objectPosition: '50% 50%' };
}

export function draftImageFramePositionStyle(template: DraftTemplate): React.CSSProperties {
  return draftRectStyle(draftImageFrameRect(template));
}

export function draftRectStyle(rect: DraftCanvasRect): React.CSSProperties {
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

export function draftImageMotionStyle(template: DraftTemplate): React.CSSProperties {
  const { motion, motionStrength } = template.image;
  const normalizedStrength = clamp(motionStrength, 0, 2);
  if (!motion || normalizedStrength <= 0) return {};
  const style = {
    '--draft-motion-scale': 1 + 0.08 * normalizedStrength,
    '--draft-motion-pan': `${4 * normalizedStrength}%`,
    animationName: `draft-motion-${motion}`,
    animationDuration: `${Math.min(16, Math.max(4, 8 / normalizedStrength))}s`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    transformOrigin: 'center',
    willChange: 'transform',
  } as React.CSSProperties & Record<string, string | number>;
  return style;
}

export function draftImageAnimationPreviewKind(animation: string | null | undefined): DraftImageAnimationPreviewKind {
  if (!animation || animation === '无动画') return 'none';
  if (/(向左缩小|形变左缩)/u.test(animation)) return 'slide-shrink-left';
  if (/(向右缩小|形变右缩)/u.test(animation)) return 'slide-shrink-right';
  if (/(向左下降|下降向左)/u.test(animation)) return 'drop-left';
  if (/(向右下降|下降向右)/u.test(animation)) return 'drop-right';
  if (/(旋转上升|上升旋转)/u.test(animation)) return 'spin-rise';
  if (/(旋转(?:下降|降落)|(?:下降|降落)旋转)/u.test(animation)) return 'spin-drop';
  if (/(旋转(?:缩小|回吸|伸缩)|缩小(?:旋转|转出))/u.test(animation)) return 'spin-shrink';
  if (/(旋出渐隐|晃动旋出)/u.test(animation)) return 'spin-out';
  if (animation.includes('上升')) return 'rise';
  if (/(下降|降落|坠落|滑滑梯)/u.test(animation)) return 'drop';
  if (animation.includes('向左') || animation.includes('左拉') || animation.includes('左滑') || /(小火车|相框滑动)/u.test(animation)) return 'slide-left';
  if (animation.includes('向右') || animation.includes('右拉') || animation.includes('右滑')) return 'slide-right';
  if (/(翻转|立方体|方片|魔方|四格转动)/u.test(animation)) return 'flip';
  if (/(分割|百叶窗|四格|三分|碎块|水晶|分身|叠叠乐|夹心饼干)/u.test(animation)) return 'split';
  if (/(悠悠球|荡秋千|海盗船|哈哈镜|摇晃|晃动|过山车|红酒)/u.test(animation)) return 'sway';
  if (/(弹入|弹出|弹动|弹跳|弹回|回弹|抖入|跳跳糖|冲屏)/u.test(animation)) return 'bounce';
  if (animation.includes('波动')) return 'wave';
  if (/(扭曲|拉伸|形变)/u.test(animation)) return 'stretch';
  if (/(缩小|回吸|吸收)/u.test(animation)) return 'shrink';
  if (/(转入转出|旋转|斜转|陀螺|绕圈|转圈|旋入|旋出)/u.test(animation)) return 'spin';
  return 'zoom';
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
  text: Pick<DraftTemplate['title'], 'fontFamily' | 'color' | 'alpha' | 'align' | 'letterSpacing' | 'lineSpacing'>,
  fontSize: React.CSSProperties['fontSize'],
  fontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties {
  return {
    color: text.color,
    fontSize,
    opacity: text.alpha,
    fontWeight,
    fontFamily: draftFontCssFamily(text.fontFamily),
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
