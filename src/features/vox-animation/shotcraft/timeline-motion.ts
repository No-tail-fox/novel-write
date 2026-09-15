/**
 * Motion adapted from Vincentwei1021/video-shotcraft, Apache-2.0.
 * Upstream: demos/data/timeline-travel/TimelineTravel.tsx at 5e71af3.
 * Changes: seconds-based timing, explicit settling/hold budget, variable item
 * count and responsive content-stage geometry. No upstream fixture data is used.
 */

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const unit = (value: number) => clamp(value, 0, 1);
const finitePositive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export const TIMELINE_FINAL_ZOOM = 1.28;
export const TIMELINE_MAX_POP = 1.25;

export interface TimelineTravelTiming {
  fps: number;
  durationInFrames: number;
  travelStart: number;
  travelEnd: number;
  zoomEnd: number;
  popLead: number;
  popDuration: number;
  holdStart: number;
}

/** Reserve the last second first, including spring settling before that hold. */
export function timelineTravelTiming(fps: number, durationInFrames: number, itemCount: number): TimelineTravelTiming {
  const rate = finitePositive(fps, 30);
  const duration = Math.max(1, Math.round(finitePositive(durationInFrames, rate * 3)));
  const reservedHold = Math.min(duration, Math.ceil(rate));
  const motionBudget = duration - reservedHold;
  const popDuration = Math.min(Math.round(rate * 26 / 30), motionBudget);
  const popLead = Math.min(Math.round(rate * 6 / 30), popDuration);
  const zoomDuration = Math.min(Math.round(rate * 10 / 30), motionBudget);
  const settling = Math.max(zoomDuration, popDuration - popLead);
  const latestTravelEnd = Math.max(0, motionBudget - settling);
  const travelStart = Math.min(Math.round(rate * 12 / 30), Math.round(latestTravelEnd * 0.18));
  const travelEnd = itemCount > 1 ? latestTravelEnd : travelStart;
  return {
    fps: rate,
    durationInFrames: duration,
    travelStart,
    travelEnd,
    zoomEnd: travelEnd + zoomDuration,
    popLead,
    popDuration,
    holdStart: Math.min(motionBudget, travelEnd + settling),
  };
}

/** The upstream slow start, sprint and final 12% brake, without frame constants. */
export function timelineTravelProgress(progress: number): number {
  const t = unit(progress);
  const inputs = [0, 0.15, 0.88, 1];
  const outputs = [0, 0.055, 0.9, 1];
  const segment = t < inputs[1] ? 0 : t < inputs[2] ? 1 : 2;
  const local = (t - inputs[segment]) / (inputs[segment + 1] - inputs[segment]);
  const eased = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2;
  return outputs[segment] + eased * (outputs[segment + 1] - outputs[segment]);
}

export function timelineCameraAt(frame: number, timing: TimelineTravelTiming, distance: number): number {
  if (distance <= 0) return 0;
  const span = timing.travelEnd - timing.travelStart;
  const progress = span > 0 ? (frame - timing.travelStart) / span : frame >= timing.travelEnd ? 1 : 0;
  return timelineTravelProgress(progress) * distance;
}

/** Invert the camera curve so each card starts rising 0.2s before arrival. */
export function timelinePopFrame(index: number, itemCount: number, timing: TimelineTravelTiming): number {
  if (index <= 0 || itemCount <= 1) return Math.max(0, timing.travelStart - timing.popLead);
  const target = unit(index / (itemCount - 1));
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (timelineTravelProgress(middle) < target) low = middle;
    else high = middle;
  }
  const arrival = Math.ceil(timing.travelStart + high * (timing.travelEnd - timing.travelStart));
  return Math.max(0, arrival - timing.popLead);
}

export function timelineZoomAt(frame: number, timing: TimelineTravelTiming): number {
  const span = timing.zoomEnd - timing.travelEnd;
  const progress = span > 0 ? unit((frame - timing.travelEnd) / span) : frame >= timing.travelEnd ? 1 : 0;
  return 1 + (TIMELINE_FINAL_ZOOM - 1) * (1 - Math.pow(1 - progress, 3));
}

/** Bounds include both the 1.28x zoom and the card's spring overshoot. */
export function timelineTravelLayout(width: number, height: number) {
  const w = finitePositive(width, 880);
  const h = finitePositive(height, 250);
  const portrait = h > w * 0.8;
  const margin = clamp(Math.min(w, h) * 0.04, 6, 24);
  const safeTop = h / 2 + (margin - h / 2) / TIMELINE_FINAL_ZOOM;
  const safeBottom = h - safeTop;
  const dateFontSize = clamp(h * 0.072, 12, 28);
  const dateHeight = dateFontSize * 1.2 * 2;
  const axisGap = clamp(h * 0.036, 6, 18);
  const axisY = safeBottom - dateHeight - axisGap;
  const cardBottom = axisY - axisGap;
  const cardHeight = Math.max(1, Math.min(h * 0.53, (cardBottom - safeTop) / TIMELINE_MAX_POP));
  const cardWidth = Math.max(1, Math.min(w * (portrait ? 0.66 : 0.62), (w - margin * 2) / TIMELINE_FINAL_ZOOM));
  return {
    width: w,
    height: h,
    portrait,
    axisY,
    axisGap,
    cardWidth,
    cardHeight,
    cardBottom,
    tickGap: Math.max(w * 0.8, cardWidth * 1.4),
    dateFontSize,
    dateHeight,
    padding: clamp(h * 0.035, 8, 22),
  };
}

// Conservative glyph widths keep Chinese and long URLs contained without DOM measurement.
function estimatedLines(text: string, columns: number): number {
  return text.split(/\r?\n/u).reduce((total, paragraph) => {
    const units = [...paragraph].reduce((sum, char) => sum + (/[\u0000-\u007f]/u.test(char) ? 0.62 : 1), 0);
    return total + Math.max(1, Math.ceil(units / Math.max(1, columns)));
  }, 0);
}

export function fitTimelineText(text: string, width: number, height: number, maximum: number, minimum: number, maxLines: number, lineHeight = 1.25) {
  const floor = Math.min(minimum, height / lineHeight);
  let fontSize = Math.min(maximum, height / lineHeight);
  while (fontSize > floor) {
    const lines = estimatedLines(text, width / fontSize);
    if (lines <= maxLines && lines * fontSize * lineHeight <= height) break;
    fontSize = Math.max(floor, fontSize - 1);
  }
  return {
    fontSize: Math.max(1, fontSize),
    lineCount: Math.max(1, Math.min(maxLines, Math.floor(height / (Math.max(1, fontSize) * lineHeight)))),
    lineHeight,
  };
}
