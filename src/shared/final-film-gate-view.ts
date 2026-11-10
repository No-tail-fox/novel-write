/**
 * Renderer-safe view of the advisory final-film gate report (`quality-gate.json`, backlog E-5).
 *
 * The main process reads the report next to a task's own final film (electron/final-film-gate-reader.ts),
 * validates it with {@link finalFilmGateReportSchema} and hands the renderer a {@link FinalFilmGateView}.
 * Missing report → `null`; unreadable / malformed report → `status: 'error'` (never thrown into the UI).
 * Pure module: no Node/Electron imports.
 */
import { z } from 'zod';
import { FINAL_FILM_GATE_KIND } from './final-film-gate';

/** Report files larger than this are treated as corrupt instead of being parsed. */
export const FINAL_FILM_GATE_REPORT_MAX_BYTES = 512 * 1024;
/** A film modified this long after the report's `checkedAt` makes the report stale. */
export const FINAL_FILM_GATE_STALE_TOLERANCE_MS = 5_000;
export const FINAL_FILM_GATE_ADVISORY_NOTE = '仅供参考，不影响交付';

export type FinalFilmGateViewStatus = 'passed' | 'warning' | 'failed' | 'error';
export type FinalFilmGateViewCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

const boundedText = (max: number) => z.string().max(max);

const finalFilmGateCheckSchema = z.object({
  id: boundedText(64).min(1),
  status: z.enum(['pass', 'warn', 'fail', 'skip']),
  code: boundedText(64).min(1),
  detail: boundedText(4000),
});

/** Shape check for `quality-gate.json` (extra fields such as `measurements` are stripped). */
export const finalFilmGateReportSchema = z.object({
  kind: z.literal(FINAL_FILM_GATE_KIND),
  version: z.literal(1),
  route: z.enum(['lemo', 'template', 'html']),
  film: boundedText(260).min(1),
  checkedAt: boundedText(64).min(1),
  status: z.enum(['passed', 'warning', 'failed', 'error']),
  passed: z.boolean(),
  checks: z.array(finalFilmGateCheckSchema).max(64),
  error: z.object({ code: boundedText(128), message: boundedText(2000) }).optional(),
});
export type ParsedFinalFilmGateReport = z.infer<typeof finalFilmGateReportSchema>;

export interface FinalFilmGateViewCheck {
  id: string;
  status: FinalFilmGateViewCheckStatus;
  code: string;
  /** Short Chinese row label, e.g. 响度 / 首帧黑帧. */
  label: string;
  /** Human Chinese message from the evaluator. */
  detail: string;
}

export interface FinalFilmGateView {
  status: FinalFilmGateViewStatus;
  route: 'lemo' | 'template' | 'html' | null;
  /** File name of the checked film (never a full path). */
  film: string | null;
  checkedAt: string | null;
  /** The film changed after the check ran: results may describe an earlier version. */
  stale: boolean;
  checks: FinalFilmGateViewCheck[];
  error?: { code: string; message: string };
}

export const FINAL_FILM_GATE_STATUS_LABELS: Readonly<Record<FinalFilmGateViewStatus, string>> = Object.freeze({
  passed: '通过', warning: '有提示', failed: '有问题', error: '检查出错',
});

export const FINAL_FILM_GATE_CHECK_STATUS_LABELS: Readonly<Record<FinalFilmGateViewCheckStatus, string>> = Object.freeze({
  pass: '通过', warn: '提示', fail: '问题', skip: '跳过',
});

const CHECK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  probe: '媒体信息', duration: '时长', codec: '编码', resolution: '分辨率', fps: '帧率', color: '色彩标签',
  audio: '音轨', loudness: '响度', 'frame-first': '首帧黑帧', 'frame-middle': '中段黑帧', 'frame-last': '尾帧黑帧',
  'lemo-signoff': '署名检查', 'lemo-credits': '素材署名',
});

const CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  FINAL_GATE_PROBE: '媒体信息', FINAL_GATE_DURATION: '时长', FINAL_GATE_CODEC: '编码', FINAL_GATE_RESOLUTION: '分辨率',
  FINAL_GATE_FPS: '帧率', FINAL_GATE_COLOR: '色彩标签', FINAL_GATE_AUDIO_MISSING: '音轨', FINAL_GATE_LOUDNESS: '响度',
  FINAL_GATE_BLACK_FRAME: '黑帧', FINAL_GATE_LEMO_SIGNOFF: '署名检查', FINAL_GATE_LEMO_CREDITS: '素材署名',
});

const ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  FINAL_GATE_FFMPEG_MISSING: '没有找到随应用打包的 ffmpeg，这次没能检查成片。',
  FINAL_GATE_FILM_MISSING: '检查时没有找到成片文件。',
  FINAL_GATE_TIMEOUT: '成片检查超时，已停止。',
  FINAL_GATE_CANCELLED: '成片检查已取消。',
  FINAL_GATE_REPORT_INVALID: '检查报告损坏或格式不对，无法显示。',
  FINAL_GATE_REPORT_UNREADABLE: '检查报告无法读取。',
  FINAL_GATE_REPORT_MISMATCH: '检查报告对应的不是当前成片。',
});

export function finalFilmGateCheckLabel(check: Pick<FinalFilmGateViewCheck, 'id' | 'code'>): string {
  return CHECK_LABELS[check.id] ?? CODE_LABELS[check.code] ?? '其他检查';
}

/** Human Chinese text for an error report; known codes get fixed wording, others keep the runner message. */
export function finalFilmGateErrorMessage(error: { code: string; message?: string } | undefined): string {
  if (!error) return '检查过程出错。';
  const known = ERROR_MESSAGES[error.code];
  if (known) return known;
  const message = (error.message ?? '').trim();
  return message ? `检查过程出错：${message.slice(0, 300)}` : '检查过程出错。';
}

/** View for an unreadable / invalid / mismatched report: always `status: 'error'`, never throws. */
export function finalFilmGateErrorView(code: string, input: { film?: string | null; route?: FinalFilmGateView['route']; checkedAt?: string | null; message?: string } = {}): FinalFilmGateView {
  return {
    status: 'error', route: input.route ?? null, film: input.film ?? null, checkedAt: input.checkedAt ?? null, stale: false, checks: [],
    error: { code, message: input.message ?? finalFilmGateErrorMessage({ code }) },
  };
}

/** Validate raw parsed JSON into a view. Invalid shapes become an error view. */
export function finalFilmGateViewFromReport(raw: unknown, options: { expectedFilm?: string; filmModifiedAtMs?: number } = {}): FinalFilmGateView {
  const parsed = finalFilmGateReportSchema.safeParse(raw);
  if (!parsed.success) return finalFilmGateErrorView('FINAL_GATE_REPORT_INVALID', { film: options.expectedFilm ?? null });
  const report = parsed.data;
  if (options.expectedFilm !== undefined && report.film !== options.expectedFilm) {
    return finalFilmGateErrorView('FINAL_GATE_REPORT_MISMATCH', { film: options.expectedFilm, route: report.route, checkedAt: report.checkedAt });
  }
  const checkedAtMs = Date.parse(report.checkedAt);
  const stale = options.filmModifiedAtMs !== undefined && Number.isFinite(checkedAtMs)
    && options.filmModifiedAtMs > checkedAtMs + FINAL_FILM_GATE_STALE_TOLERANCE_MS;
  const base = { route: report.route, film: report.film, checkedAt: report.checkedAt, stale };
  if (report.status === 'error') {
    const error = report.error ?? { code: 'FINAL_GATE_ERROR', message: '' };
    return { ...base, status: 'error', checks: [], error: { code: error.code, message: finalFilmGateErrorMessage(error) } };
  }
  const checks = report.checks.map(check => ({ id: check.id, status: check.status, code: check.code, label: finalFilmGateCheckLabel(check), detail: check.detail }));
  // Derive the overall status from the rows so a hand-edited `status` cannot hide a failing row.
  const status: FinalFilmGateViewStatus = checks.some(check => check.status === 'fail') ? 'failed'
    : checks.some(check => check.status === 'warn') ? 'warning'
      : report.status === 'passed' ? 'passed' : report.status;
  return { ...base, status, checks };
}

/** Compact one-line summary used by the director review report. */
export function finalFilmGateSummaryText(view: FinalFilmGateView): string {
  if (view.status === 'error') return `成片检查出错：${view.error?.message ?? finalFilmGateErrorMessage(undefined)}`;
  const fails = view.checks.filter(check => check.status === 'fail').length;
  const warns = view.checks.filter(check => check.status === 'warn').length;
  const counted = view.checks.filter(check => check.status !== 'skip').length;
  if (!fails && !warns) return `成片检查通过（${counted} 项）`;
  return `成片检查${[fails ? `${fails} 项有问题` : '', warns ? `${warns} 项有提示` : ''].filter(Boolean).join('、')}`;
}
