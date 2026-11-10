import { useEffect, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import {
  FINAL_FILM_GATE_ADVISORY_NOTE, FINAL_FILM_GATE_CHECK_STATUS_LABELS, FINAL_FILM_GATE_STATUS_LABELS, finalFilmGateSummaryText,
  type FinalFilmGateView, type FinalFilmGateViewCheck,
} from '../../shared/final-film-gate-view';
import '../../styles/features/final-film-gate.css';

/** E-5: result of reading the task's `quality-gate.json` through the read-only `getFinalFilmGate` IPC. */
export interface FinalFilmGateState {
  view: FinalFilmGateView | null;
  loading: boolean;
  /** The IPC read itself failed (not a gate error): shown as 检查出错, never thrown. */
  error?: string;
}

const IDLE: FinalFilmGateState = Object.freeze({ view: null, loading: false });

/**
 * Loads the advisory final-film gate for `taskId` whenever `refreshKey` changes (new film / new report).
 * Disabled (no film) → idle. Read-only: never re-runs the gate and never spends money.
 */
export function useFinalFilmGate(
  api: Pick<StoryDreamApi, 'getFinalFilmGate'> | undefined,
  taskId: string | undefined,
  options: { episodeId?: string; refreshKey: string; enabled: boolean },
): FinalFilmGateState {
  const { episodeId, refreshKey, enabled } = options;
  const requestKey = enabled && api && taskId ? `${taskId}\u0000${episodeId ?? ''}\u0000${refreshKey}` : '';
  const [result, setResult] = useState<{ key: string; state: FinalFilmGateState }>({ key: '', state: IDLE });
  useEffect(() => {
    if (!requestKey || !api || !taskId) return undefined;
    let cancelled = false;
    setResult({ key: requestKey, state: { view: null, loading: true } });
    void api.getFinalFilmGate({ id: taskId, ...(episodeId ? { episodeId } : {}) })
      .then((view) => { if (!cancelled) setResult({ key: requestKey, state: { view: view ?? null, loading: false } }); })
      .catch((cause: unknown) => {
        if (!cancelled) setResult({ key: requestKey, state: { view: null, loading: false, error: cause instanceof Error ? cause.message : String(cause) } });
      });
    return () => { cancelled = true; };
  }, [api, episodeId, requestKey, taskId]);
  if (!requestKey) return IDLE;
  return result.key === requestKey ? result.state : { view: null, loading: true };
}

function formatCheckedAt(value: string | null): string {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '';
}

const STATUS_ORDER: Record<FinalFilmGateViewCheck['status'], number> = { fail: 0, warn: 1, pass: 2, skip: 3 };

function CheckRows({ checks }: { checks: readonly FinalFilmGateViewCheck[] }) {
  return <ul className="final-film-gate__rows">
    {checks.map((check) => <li key={check.id} className={`final-film-gate__row is-${check.status}`} data-final-film-check={check.id} data-check-status={check.status}>
      <span className={`final-film-gate__row-status is-${check.status}`}>{FINAL_FILM_GATE_CHECK_STATUS_LABELS[check.status]}</span>
      <strong>{check.label}</strong>
      <span className="final-film-gate__detail">{check.detail}</span>
    </li>)}
  </ul>;
}

/**
 * Compact "成片检查" panel. `variant="review"` (director 审片报告) lists only rows that need attention.
 * Renders nothing while loading or when the film has no report (old projects / gate disabled).
 */
export function FinalFilmGatePanel({ view, loading, error, variant = 'delivery' }: FinalFilmGateState & { variant?: 'delivery' | 'review' }) {
  if (loading && !view) return null;
  const shown: FinalFilmGateView | null = view ?? (error
    ? { status: 'error', route: null, film: null, checkedAt: null, stale: false, checks: [], error: { code: 'FINAL_GATE_READ_FAILED', message: `读取检查结果失败：${error.slice(0, 300)}` } }
    : null);
  if (!shown) return null;
  const ordered = [...shown.checks].sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status]);
  const attention = ordered.filter((check) => check.status === 'fail' || check.status === 'warn');
  const checkedAt = formatCheckedAt(shown.checkedAt);
  return <section className={`final-film-gate final-film-gate--${variant} is-${shown.status}`} aria-label="成片检查" data-final-film-gate-status={shown.status}>
    <div className="final-film-gate__head">
      <strong>成片检查</strong>
      <span className={`final-film-gate__badge is-${shown.status}`}>{FINAL_FILM_GATE_STATUS_LABELS[shown.status]}</span>
      <small className="final-film-gate__advisory">{FINAL_FILM_GATE_ADVISORY_NOTE}</small>
    </div>
    {shown.status === 'error'
      ? <p className="final-film-gate__note" role="status">{shown.error?.message ?? '检查过程出错。'}</p>
      : <p className="final-film-gate__note" role="status">{finalFilmGateSummaryText(shown)}{checkedAt ? ` · 检查于 ${checkedAt}` : ''}</p>}
    {shown.stale ? <p className="final-film-gate__note is-stale" role="note">成片在检查之后有改动，以下结果可能对应较早的版本。</p> : null}
    {variant === 'review'
      ? (attention.length ? <CheckRows checks={attention} /> : null)
      : ordered.length ? <details className="final-film-gate__details" open={shown.status !== 'passed'}>
        <summary>查看 {ordered.length} 项检查明细</summary>
        <CheckRows checks={ordered} />
      </details> : null}
  </section>;
}

/** Self-loading variant for screens that already hold `api` (HTML 视频出片页). */
export function TaskFinalFilmGatePanel({ api, taskId, episodeId, refreshKey, enabled = true, variant }: {
  api: Pick<StoryDreamApi, 'getFinalFilmGate'>; taskId: string; episodeId?: string; refreshKey: string; enabled?: boolean; variant?: 'delivery' | 'review';
}) {
  const state = useFinalFilmGate(api, taskId, { ...(episodeId ? { episodeId } : {}), refreshKey, enabled });
  return <FinalFilmGatePanel {...state} {...(variant ? { variant } : {})} />;
}
