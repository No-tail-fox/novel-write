/**
 * Adapted from video-shotcraft at 5e71af35 (Apache-2.0):
 * demos/ui-entrance/bezier-source-converge-merge/BezierSourceConvergeMerge.tsx
 * demos/data/ring-diagram-annotation-reveal/RingDiagramAnnotationReveal.tsx
 * and demos/_fixtures/Motion.tsx.
 * Changes: user content/colors/assets, responsive content-stage geometry,
 * deterministic arc-length sampling, and frame-rate-independent timing.
 * No upstream image or audio assets are included.
 */
import React, { useMemo, type CSSProperties } from 'react';
import { Easing, Img } from 'remotion';
import type { ShotcraftSceneProps } from './types';

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const linear = (t: number) => t;
const outQuad = (t: number) => t * (2 - t);
const outCubic = (t: number) => 1 - (1 - t) ** 3;
const inOutCubic = (t: number) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const outBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const apertureEase = Easing.bezier(.16, 1, .3, 1);
const segment = (t: number, start: number, end: number, ease = linear) => ease(clamp((t - start) / (end - start)));
const sceneTime = (frame: number, fps: number, duration: number) => {
  const rate = Math.max(1, fps);
  return clamp((frame / rate) / Math.max(1 / rate, (duration - 1) / rate));
};
const textBase: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.28 };

// Deliberately conservative glyph widths keep Chinese/Latin wrapping deterministic
// without DOM measurement. The host validates editorial text length before apply.
function wrapText(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  // Editorial labels reflow whitespace so pasted line breaks cannot create
  // empty rows that push otherwise valid content out of its allocated cell.
  for (const paragraph of [text.replace(/\s+/gu, ' ').trim()]) {
    let line = '', used = 0;
    for (const char of Array.from(paragraph)) {
      const advance = size * (/[^\u0000-\u00ff]/u.test(char) ? 1 : /[MW@%]/.test(char) ? .9 : .64);
      if (line && used + advance > width) { lines.push(line); line = ''; used = 0; }
      line += char;
      used += advance;
    }
    lines.push(line);
  }
  return lines;
}

function TextBlock({ text, width, height, maxSize, minSize = 20, style }: {
  text: string; width: number; height: number; maxSize: number; minSize?: number; style?: CSSProperties;
}) {
  let size = maxSize;
  let lines = wrapText(text, width, size);
  while (size > minSize && lines.length * size * 1.28 > height) {
    size = Math.max(minSize, size - 1);
    lines = wrapText(text, width, size);
  }
  return <div style={{ ...textBase, width, fontSize: size, ...style }}>{lines.join('\n')}</div>;
}

type Point = { x: number; y: number };
type FlowPath = { start: Point; control1: Point; control2: Point; end: Point };

function cubic(path: FlowPath, t: number): Point {
  const v = 1 - t;
  return {
    x: v ** 3 * path.start.x + 3 * v ** 2 * t * path.control1.x + 3 * v * t ** 2 * path.control2.x + t ** 3 * path.end.x,
    y: v ** 3 * path.start.y + 3 * v ** 2 * t * path.control1.y + 3 * v * t ** 2 * path.control2.y + t ** 3 * path.end.y,
  };
}

function samplePath(path: FlowPath) {
  const count = 320;
  const lengths = [0];
  let previous = path.start;
  for (let i = 1; i <= count; i++) {
    const point = cubic(path, i / count);
    lengths.push(lengths[i - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  const length = lengths[count];
  return {
    path,
    d: `M ${path.start.x} ${path.start.y} C ${path.control1.x} ${path.control1.y} ${path.control2.x} ${path.control2.y} ${path.end.x} ${path.end.y}`,
    pointAt: (fraction: number): Point => {
      const target = clamp(fraction) * length;
      let low = 0, high = count;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (lengths[mid] < target) low = mid + 1;
        else high = mid;
      }
      const index = Math.max(1, low);
      const previousLength = lengths[index - 1];
      const interval = lengths[index] - previousLength;
      return cubic(path, (index - 1 + (interval ? (target - previousLength) / interval : 0)) / count);
    },
  };
}

/** Independent sources connect, travel along their curves, and are absorbed. */
export function SourceMergeShot({ p, frame, fps, durationInFrames, width, height }: ShotcraftSceneProps) {
  const items = p.items.slice(0, 6);
  const vertical = height > width * .95;
  const t = sceneTime(frame, fps, durationInFrames);
  const margin = Math.min(width, height) * .065;
  const nodeSize = vertical ? 64 : Math.min(58, height / Math.max(2, items.length) * .76);
  const rows = Math.ceil(items.length / 2);
  const rowHeight = vertical ? height * .56 / Math.max(1, rows) : (height - margin * 2) / Math.max(1, items.length);
  const availableLabelLines = Math.max(1, Math.floor(rowHeight / (20 * 1.28)));
  const longestLabel = Math.max(0, ...items.map(item => Array.from(item.label).reduce((sum, char) =>
    sum + (/[^\u0000-\u00ff]/u.test(char) ? 1 : .64), 0)));
  // Six longer source names need a wider label column in shallow landscape
  // stages. Reflow geometry instead of shrinking labels below a readable size.
  const labelWidth = vertical ? width * .27 : Math.min(width * .68, Math.max(width * .29, longestLabel * 20 / availableLabelLines + 6));
  const sourceX = margin + labelWidth + nodeSize / 2 + 12;
  const result = { x: vertical ? width * .5 : Math.min(width - margin - nodeSize / 2, Math.max(width * .78, sourceX + width * .15)),
    y: height * (vertical ? .79 : .45) };
  const paths = useMemo(() => items.map((_, i) => {
    const start = vertical ? {
      x: width * (i % 2 ? .64 : .36),
      y: height * .1 + rowHeight * (Math.floor(i / 2) + .5),
    } : {
      x: sourceX,
      y: margin + rowHeight * (i + .5),
    };
    return samplePath({
      start,
      control1: vertical ? { x: start.x, y: start.y + (result.y - start.y) * .55 } : { x: lerp(start.x, result.x, .43), y: start.y },
      control2: vertical ? { x: result.x, y: result.y - height * .17 } : { x: lerp(start.x, result.x, .55), y: result.y },
      end: result,
    });
  }), [items.length, vertical, width, height, margin, rowHeight, result.x, result.y, sourceX]);
  const converge = segment(t, .34, .74, inOutCubic);
  const erase = segment(t, .78, .9, outQuad);
  const packetCycle = (segment(t, .1, .74) * 2) % 1;
  const badgeIn = segment(t, .16, .26, outCubic);
  const badgeScale = lerp(.7, 1, badgeIn) * (1 + .12 * segment(t, .7, .78, outBack) - .12 * segment(t, .78, .86, outQuad));
  const badgeSize = Math.min(vertical ? 104 : 84, height * .25);
  const resultWidth = vertical ? width * .78 : width * .88;
  const resultY = Math.max(result.y + badgeSize * .67, vertical ? 0 : height * .7);
  return <div style={{ position: 'absolute', inset: 0, color: p.foreground }}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0 }}>
      {paths.map((path, i) => {
        // Keep all six connections complete before the .34 absorption window.
        const stagger = .13 / Math.max(1, items.length - 1);
        const draw = segment(t, .04 + i * stagger, .21 + i * stagger, outQuad);
        const phase = (packetCycle + i * .13) % 1;
        const packet = path.pointAt(phase);
        const packetOn = segment(t, .1, .16) * (1 - segment(t, .7, .76));
        return <g key={i}>
          <path d={path.d} fill="none" stroke={p.foreground} strokeWidth={vertical ? 2 : 1.8}
            pathLength={1} strokeDasharray="1 1" strokeDashoffset={erase > 0 ? -erase : 1 - draw}
            opacity={draw * (1 - segment(erase, .85, 1)) * .65} />
          <circle cx={packet.x} cy={packet.y} r={vertical ? 5 : 4} stroke={p.accent} strokeWidth={2} fill={`${p.accent}28`}
            opacity={packetOn * (1 - Math.abs(phase - .5) * .6)} />
        </g>;
      })}
    </svg>
    {paths.map((path, i) => {
      const item = items[i];
      const point = path.pointAt(converge);
      const appear = segment(t, .02 + i * .022, .12 + i * .022, outCubic);
      const size = converge < .75 ? lerp(nodeSize, nodeSize * 15 / 44, converge / .75) : lerp(nodeSize * 15 / 44, 0, (converge - .75) / .25);
      const labelX = vertical && i % 2 ? path.path.start.x + nodeSize / 2 + 12 : path.path.start.x - nodeSize / 2 - 12 - labelWidth;
      const labelHeight = Math.min(rowHeight * .92, vertical ? 148 : rowHeight);
      return <React.Fragment key={i}>
        <div style={{ position: 'absolute', left: labelX, top: path.path.start.y - labelHeight / 2,
          height: labelHeight, display: 'flex', alignItems: 'center', opacity: appear * (1 - segment(t, .34, .42)),
          transform: `translateY(${(1 - appear) * 9}px)` }}>
          <TextBlock text={item.label} width={labelWidth} height={labelHeight} maxSize={vertical ? 28 : 25} minSize={20}
            style={{ fontWeight: 650, textAlign: vertical && i % 2 ? 'left' : 'right' }} />
        </div>
        <div style={{ position: 'absolute', left: point.x - nodeSize / 2, top: point.y - nodeSize / 2,
          width: nodeSize, height: nodeSize, display: 'grid', placeItems: 'center', borderRadius: '50%',
          background: p.background, border: `1.5px solid ${p.foreground}45`, boxShadow: `0 4px 12px ${p.foreground}12`,
          fontSize: nodeSize * .38, fontWeight: 750,
          opacity: appear * (converge > .92 ? clamp((1 - converge) / .08) : 1),
          transform: `scale(${appear * size / Math.max(1, nodeSize)})` }}>
          {Array.from(item.label.trim())[0]}
        </div>
      </React.Fragment>;
    })}
    <div style={{ position: 'absolute', left: result.x - badgeSize / 2, top: result.y - badgeSize / 2,
      width: badgeSize, height: badgeSize, display: 'grid', placeItems: 'center', borderRadius: '50%',
      background: p.background, border: `2px solid ${p.accent}`, boxShadow: `0 7px 20px ${p.foreground}12`,
      opacity: badgeIn, transform: `scale(${badgeScale})` }}>
      <svg width={badgeSize * .5} height={badgeSize * .5} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .8 14.3 9.7 23.2 12 14.3 14.3 12 23.2 9.7 14.3 .8 12 9.7 9.7Z" fill={p.accent} />
      </svg>
    </div>
    {p.subtitle && <div style={{ position: 'absolute', left: width / 2 - resultWidth / 2, top: resultY,
      opacity: segment(t, .84, .9), transform: `translateY(${(1 - segment(t, .84, .94, outCubic)) * 8}px)` }}>
      <TextBlock text={p.subtitle} width={resultWidth} height={height - resultY - margin} maxSize={vertical ? 32 : 28}
        style={{ fontWeight: 750, textAlign: 'center' }} />
    </div>}
  </div>;
}

/** A subject contracts into an independently rotating ring diagram and annotations. */
export function RingRevealShot({ p, images, frame, fps, durationInFrames, width, height }: ShotcraftSceneProps) {
  const t = sceneTime(frame, fps, durationInFrames);
  const phase = (start: number, end: number) => segment(t, start / 189, end / 189, apertureEase);
  const vertical = height > width * .95;
  const items = p.items.slice(0, 4);
  const margin = Math.min(width, height) * .04;
  const dense = !vertical && items.length > 2;
  const diameter = vertical ? Math.min(width * .76, height * .4) : Math.min(width * (dense ? .27 : .4), height * .68);
  const aperture = phase(11, 50), ringIn = phase(18, 60), coilsIn = phase(30, 50), arrowsIn = phase(35, 50);
  const layout = phase(90, 134);
  const center = {
    x: lerp(width / 2, vertical ? width / 2 : width * (dense ? .135 : .22), layout),
    y: lerp(height * (vertical ? .4 : .42), vertical ? height * .225 : height * .36, layout),
  };
  const scale = lerp(1, .84, layout);
  const outer = diameter * .46, inner = diameter * .335, subjectRadius = diameter * .277;
  const rotation = segment(t, 29 / 189, 187 / 189) * 44.2;
  const apertureRadius = lerp(Math.hypot(width, height), subjectRadius, aperture) * scale;
  const labelsLeft = vertical ? margin : width * (dense ? .28 : .46);
  const labelsTop = vertical ? height * .52 : margin;
  const labelsWidth = vertical ? width - margin * 2 : width - labelsLeft - margin;
  const labelsHeight = height - labelsTop - margin;
  const columns = items.length > 2 ? 2 : 1;
  const rows = Math.ceil(items.length / columns);
  const gap = vertical ? 28 : 12;
  const cellWidth = (labelsWidth - gap * (columns - 1)) / columns;
  const cellHeight = (labelsHeight - gap * Math.max(0, rows - 1)) / Math.max(1, rows);
  const subjectText = p.subtitle;
  const subjectWidth = vertical ? width * .78 : width * (dense ? .265 : .41);
  const subjectTop = center.y + diameter * .5 * scale + 6;
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: p.foreground }}>
    <div style={{ position: 'absolute', inset: 0, background: `${p.foreground}16`,
      clipPath: `circle(${apertureRadius}px at ${center.x}px ${center.y}px)` }} />
    <div style={{ position: 'absolute', left: center.x, top: center.y, width: diameter, height: diameter,
      transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: '50% 50%' }}>
      <svg width={diameter} height={diameter} viewBox={`${-diameter / 2} ${-diameter / 2} ${diameter} ${diameter}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <circle r={inner} fill="none" stroke={`${p.foreground}80`} strokeWidth={1.8} opacity={ringIn}
          transform={`scale(${lerp(3.8, 1, ringIn)})`} />
        <circle r={outer} fill="none" stroke={p.accent} strokeWidth={diameter * .03} pathLength={120}
          strokeDasharray="7 3" opacity={coilsIn}
          transform={`rotate(${rotation}) scale(${lerp(1.08, 1, coilsIn)})`} />
        {/* Arrowheads are explicit geometry: only the outer segmented ring rotates. */}
        <g opacity={arrowsIn} stroke={p.foreground} strokeWidth={1.3} fill={p.foreground}>
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (-90 + i * 30) * Math.PI / 180;
            const radius = lerp(diameter * .438, diameter * .325, arrowsIn);
            const start = { x: Math.cos(angle) * diameter * .438, y: Math.sin(angle) * diameter * .438 };
            const end = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
            const head = diameter * .018;
            const back = { x: end.x + Math.cos(angle) * head, y: end.y + Math.sin(angle) * head };
            return <g key={i}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <path d={`M ${end.x} ${end.y} L ${back.x - Math.sin(angle) * head * .55} ${back.y + Math.cos(angle) * head * .55} L ${back.x + Math.sin(angle) * head * .55} ${back.y - Math.cos(angle) * head * .55} Z`} stroke="none" />
            </g>;
          })}
        </g>
      </svg>
      <div style={{ position: 'absolute', left: diameter / 2 - subjectRadius, top: diameter / 2 - subjectRadius,
        width: subjectRadius * 2, height: subjectRadius * 2, borderRadius: '50%', overflow: 'hidden',
        background: p.background, border: `1px solid ${p.foreground}26`, display: 'grid', placeItems: 'center' }}>
        {images[0] ? <Img src={images[0]} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> :
          <div style={{ position: 'absolute', inset: 0, background: `${p.foreground}12` }} />}
        {!images[0] && subjectText && <div style={{ position: 'relative', fontSize: subjectRadius * .65, fontWeight: 750, color: p.accent }}>
          {Array.from(subjectText.trim())[0]}
        </div>}
      </div>
    </div>
    {subjectText && <div style={{ position: 'absolute', left: center.x - subjectWidth / 2, top: subjectTop,
      opacity: phase(50, 70) }}>
      <TextBlock text={subjectText} width={subjectWidth} height={(vertical ? labelsTop : height - margin) - subjectTop - 8}
        maxSize={vertical ? 30 : 24} minSize={18} style={{ textAlign: 'center', fontWeight: 750 }} />
    </div>}
    <div style={{ position: 'absolute', left: labelsLeft, top: labelsTop, width: labelsWidth, height: labelsHeight,
      display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, rows)}, minmax(0, 1fr))`, gap }}>
      {items.map((item, i) => {
        const titleIn = phase(112 + i * 3, 120 + i * 3);
        const bandIn = phase(114 + i * 2, 154 + i * 2);
        const detailIn = phase(137 + i * 2, 143 + i * 2);
        const padding = vertical ? 22 : dense ? 5 : 12;
        const textWidth = cellWidth - padding * 2;
        const textGap = vertical ? 10 : 6;
        let titleSize = vertical ? 30 : 26;
        let detailSize = vertical ? 25 : 22;
        const neededHeight = () => wrapText(item.label, textWidth, titleSize).length * titleSize * 1.28 +
          (item.detail ? wrapText(item.detail, textWidth, detailSize).length * detailSize * 1.28 + textGap : 0);
        while ((titleSize > 18 || detailSize > 18) && neededHeight() > cellHeight - padding * 2) {
          titleSize = Math.max(18, titleSize - 1);
          detailSize = Math.max(18, detailSize - 1);
        }
        const titleHeight = wrapText(item.label, textWidth, titleSize).length * titleSize * 1.28;
        const detailHeight = cellHeight - titleHeight - padding * 2 - textGap;
        return <div key={i} style={{ minWidth: 0, position: 'relative', padding, boxSizing: 'border-box' }}>
          <div style={{ position: 'absolute', inset: 0, background: `${p.foreground}08`, borderTop: `3px solid ${p.accent}`,
            transformOrigin: 'left center', transform: `scaleX(${bandIn})`, opacity: bandIn }} />
          <div style={{ position: 'relative', height: titleHeight,
            opacity: titleIn, clipPath: `inset(${(1 - titleIn) * 100}% 0 0 0)`, transform: `translateY(${(1 - titleIn) * 18}px)` }}>
            <TextBlock text={item.label} width={textWidth} height={titleHeight} maxSize={titleSize} minSize={18}
              style={{ fontWeight: 750, color: p.foreground }} />
          </div>
          {item.detail && <div style={{ position: 'relative', marginTop: textGap, opacity: detailIn, transform: `translateY(${(1 - detailIn) * 9}px)` }}>
            <TextBlock text={item.detail} width={textWidth} height={detailHeight} maxSize={detailSize} minSize={18}
              style={{ color: p.foreground, opacity: .82 }} />
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
