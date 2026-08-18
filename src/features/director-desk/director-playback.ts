export interface DirectorPlaybackShot {
  id: string;
  durationMs: number;
}

export function clampPlaybackTime(value: number, totalDuration: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, totalDuration), Math.max(0, value));
}

export function playbackShotOffset(shots: readonly DirectorPlaybackShot[], shotId: string): number {
  const index = shots.findIndex((shot) => shot.id === shotId);
  if (index <= 0) return 0;
  return shots.slice(0, index).reduce((total, shot) => total + Math.max(0, shot.durationMs), 0);
}

export function playbackShotAt<T extends DirectorPlaybackShot>(shots: readonly T[], playbackMs: number): T | undefined {
  if (shots.length === 0) return undefined;
  const totalDuration = shots.reduce((total, shot) => total + Math.max(0, shot.durationMs), 0);
  const target = clampPlaybackTime(playbackMs, totalDuration);
  if (target >= totalDuration) return shots.at(-1);
  let offset = 0;
  return shots.find((shot) => {
    const end = offset + Math.max(0, shot.durationMs);
    const ownsTarget = target >= offset && target < end;
    offset = end;
    return ownsTarget;
  }) ?? shots.at(-1);
}

export function formatPlaybackTime(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
