import { useState } from 'react';
import { Button } from '../../ui';

export const MOTION_COMIC_VIDEO_CANDIDATE_MIME = 'application/x-storydream-video-candidate';

export interface MotionComicVideoCandidate {
  id: string;
  label: string;
  meta: string;
  current: boolean;
  unavailableReason?: string;
  /** Local asset URL for the video file; present whenever the file exists on disk. */
  videoUrl?: string;
}

export interface MotionComicCandidateShot {
  id: string;
  index: number;
  title: string;
  /** First-frame keyframe URL shown as a visual preview for the shot group. */
  thumbnailUrl?: string;
  candidates: readonly MotionComicVideoCandidate[];
}

export function readCandidateDrag(dataTransfer: DataTransfer): { shotId: string; versionId: string } | null {
  try {
    const value = JSON.parse(dataTransfer.getData(MOTION_COMIC_VIDEO_CANDIDATE_MIME)) as { shotId?: unknown; versionId?: unknown };
    return typeof value.shotId === 'string' && typeof value.versionId === 'string' ? { shotId: value.shotId, versionId: value.versionId } : null;
  } catch { return null; }
}

export function MotionComicCandidateDock({ shots, selectedShotId, busy, onSelectShot, onAdopt }: {
  shots: readonly MotionComicCandidateShot[];
  selectedShotId: string;
  busy: boolean;
  onSelectShot: (shotId: string) => void;
  onAdopt: (shotId: string, versionId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  async function adopt(shotId: string, versionId: string) {
    if (busy || pending) return;
    setPending(versionId); setFeedback('');
    try { await onAdopt(shotId, versionId); setFeedback('已采用，时间线已更新。'); }
    catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setPending(''); }
  }
  return <section className='comic-candidate-dock' aria-label='候选视频'>
    <header><strong>候选视频</strong><small>拖到时间线对应镜头的视频条上采用</small></header>
    <div className='comic-candidate-dock__scroll'>
      {shots.map((shot) => <section key={shot.id} className='comic-candidate-dock__shot' data-selected={shot.id === selectedShotId} aria-label={`镜头 ${shot.index}`}>
        <button type='button' className='comic-candidate-dock__title' onClick={() => onSelectShot(shot.id)}>
          {shot.thumbnailUrl
            ? <img className='comic-candidate-dock__shot-thumb' src={shot.thumbnailUrl} alt='' loading='lazy' />
            : <span className='comic-candidate-dock__shot-thumb comic-candidate-dock__shot-thumb--empty' aria-hidden='true' />}
          <span className='comic-candidate-dock__title-text'>{String(shot.index).padStart(2, '0')} · {shot.title}<small>{shot.candidates.length} 个候选</small></span>
        </button>
        {shot.candidates.length ? <ul>{shot.candidates.map((candidate) => <li key={candidate.id} data-current={candidate.current} draggable={!busy} title={candidate.unavailableReason ?? '拖到时间线视频条上采用'} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(MOTION_COMIC_VIDEO_CANDIDATE_MIME, JSON.stringify({ shotId: shot.id, versionId: candidate.id })); }}>
          {candidate.videoUrl
            ? <video className='comic-candidate-dock__video-thumb' src={candidate.videoUrl} preload='metadata' muted aria-hidden='true' />
            : <span className='comic-candidate-dock__video-thumb comic-candidate-dock__video-thumb--empty' aria-hidden='true' />}
          <span className='comic-candidate-dock__candidate-copy'><strong>{candidate.label}{candidate.current ? ' · 当前' : ''}</strong><small>{candidate.unavailableReason ?? candidate.meta}</small></span>
          <Button density='compact' variant='subtle' disabled={busy || Boolean(pending) || candidate.current || Boolean(candidate.unavailableReason)} onClick={() => void adopt(shot.id, candidate.id)}>{pending === candidate.id ? '处理中…' : candidate.current ? '使用中' : '采用'}</Button>
        </li>)}</ul> : <p>暂无候选视频</p>}
      </section>)}
    </div>
    <p role='status' aria-live='polite'>{feedback}</p>
  </section>;
}
