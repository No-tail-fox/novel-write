/**
 * Adapted from Vincentwei1021/video-shotcraft (Apache-2.0), commit 5e71af3:
 * demos/data/timeline-travel/TimelineTravel.tsx and its timeline-travel recipe.
 * StoryDream changes: editable real content, optional images, responsive stage
 * geometry, host FPS/duration and a complete one-second hold after all motion.
 */
import type { CSSProperties } from 'react';
import { Img, spring } from 'remotion';
import type { ShotcraftSceneProps } from './types';
import {
  fitTimelineText,
  TIMELINE_MAX_POP,
  timelineCameraAt,
  timelinePopFrame,
  timelineTravelLayout,
  timelineTravelTiming,
  timelineZoomAt,
} from './timeline-motion';

const textBox = (fit: ReturnType<typeof fitTimelineText>): CSSProperties => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: fit.lineCount,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
  fontSize: fit.fontSize,
  lineHeight: fit.lineHeight,
  margin: 0,
});

export function TimelineTravelShot(s: ShotcraftSceneProps) {
  const { p, images, frame, fps, durationInFrames, width, height } = s;
  const items = p.items.slice(0, 5);
  const timing = timelineTravelTiming(fps, durationInFrames, items.length);
  const layout = timelineTravelLayout(width, height);
  const { cardWidth, cardHeight, axisY, axisGap, cardBottom, tickGap, padding, portrait } = layout;
  const distance = tickGap * Math.max(0, items.length - 1);
  const cameraX = timelineCameraAt(frame, timing, distance);
  const zoom = items.length ? timelineZoomAt(frame, timing) : 1;
  const worldWidth = layout.width + distance;
  const minorTicks = Math.max(1, items.length - 1) * 5 + 11;
  const innerHeight = Math.max(1, cardHeight - padding * 2 - (portrait ? 6.5 : 4.5));
  const innerWidth = Math.max(1, cardWidth - padding * 2 - 3);
  const contentGap = Math.max(5, padding * 0.6);

  return (
    <div style={{
      position: 'relative', width: layout.width, height: layout.height,
      overflow: 'hidden', color: p.foreground,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        transform: `scale(${zoom})`, transformOrigin: '50% 50%',
      }}>
        <div style={{
          position: 'absolute', width: worldWidth, height: layout.height,
          transform: `translateX(${-cameraX}px)`,
        }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, top: axisY - 1,
            height: 2, background: p.foreground, opacity: 0.32,
          }} />
          {Array.from({ length: minorTicks }, (_, index) => index % 5 ? (
            <div key={`minor-${index}`} style={{
              position: 'absolute', left: layout.width / 2 + (index - 5) * tickGap / 5,
              top: axisY - axisGap * 0.45, width: 1.5, height: axisGap * 0.9,
              background: p.foreground, opacity: 0.28,
            }} />
          ) : null)}
          {items.map((item, index) => {
            const popFrame = timelinePopFrame(index, items.length, timing);
            const pop = frame >= timing.holdStart ? 1 : frame < popFrame ? 0 : Math.min(TIMELINE_MAX_POP, Math.max(0, spring({
              frame: frame - popFrame,
              fps: timing.fps,
              durationInFrames: Math.max(1, timing.popDuration),
              config: { damping: 11, stiffness: 160, mass: 0.9 },
            })));
            const image = images[index];
            const imageWidth = image && !portrait ? Math.min(innerWidth * 0.29, innerHeight * 1.25) : 0;
            const imageHeight = image && portrait ? innerHeight * 0.45 : 0;
            const textWidth = Math.max(1, innerWidth - (imageWidth ? imageWidth + contentGap : 0));
            const textHeight = Math.max(1, innerHeight - (imageHeight ? imageHeight + contentGap : 0));
            const hasLabel = Boolean(item.label.trim());
            const hasDetail = Boolean(item.detail.trim());
            const labelHeight = hasDetail && hasLabel ? (textHeight - contentGap) * 0.47 : textHeight;
            const detailHeight = hasDetail && hasLabel ? textHeight - contentGap - labelHeight : textHeight;
            const labelFit = fitTimelineText(item.label, textWidth, labelHeight, portrait ? 36 : 24, portrait ? 22 : 14, hasDetail ? 2 : 4, 1.18);
            const detailFit = fitTimelineText(item.detail, textWidth, detailHeight, portrait ? 25 : 17, portrait ? 18 : 12, portrait ? 5 : 3, 1.3);
            const dateFit = fitTimelineText(item.date, cardWidth, layout.dateHeight, layout.dateFontSize, portrait ? 20 : 13, 2, 1.2);

            return (
              <div key={index} style={{ position: 'absolute', left: layout.width / 2 + index * tickGap, top: 0 }}>
                <div style={{
                  position: 'absolute', left: -2, top: axisY - axisGap * 0.7,
                  width: 4, height: axisGap * 1.4, background: p.accent, borderRadius: 1,
                }} />
                {item.date ? (
                  <div style={{
                    ...textBox(dateFit), position: 'absolute', left: -cardWidth / 2,
                    top: axisY + axisGap, width: cardWidth, textAlign: 'center',
                    fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {item.date}
                  </div>
                ) : null}
                {(hasLabel || hasDetail || image) && frame >= popFrame ? (
                  <div style={{
                    position: 'absolute',
                    left: -cardWidth / 2,
                    top: cardBottom - cardHeight,
                    width: cardWidth,
                    height: cardHeight,
                    boxSizing: 'border-box',
                    padding,
                    display: 'flex',
                    flexDirection: portrait ? 'column' : 'row',
                    alignItems: 'center',
                    gap: contentGap,
                    border: `1.5px solid ${p.foreground}45`,
                    borderTop: `${portrait ? 5 : 3}px solid ${p.accent}`,
                    borderRadius: 3,
                    background: p.background,
                    boxShadow: `0 ${padding * 0.5}px ${padding * 1.1}px ${p.foreground}1c`,
                    transform: `scaleY(${pop}) scaleX(${0.6 + 0.4 * pop})`,
                    transformOrigin: '50% 100%',
                    opacity: Math.min(1, pop * 2),
                  }}>
                    {image ? <Img src={image} style={{
                      width: portrait ? innerWidth : imageWidth,
                      height: portrait ? imageHeight : innerHeight,
                      objectFit: 'contain', flexShrink: 0,
                    }} /> : null}
                    <div style={{
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      gap: contentGap, width: textWidth, height: textHeight, minWidth: 0, flexShrink: 0,
                    }}>
                      {hasLabel ? <div style={{ ...textBox(labelFit), maxHeight: labelHeight, fontWeight: 850 }}>{item.label}</div> : null}
                      {hasDetail ? <div style={{ ...textBox(detailFit), maxHeight: detailHeight, opacity: 0.82 }}>{item.detail}</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
