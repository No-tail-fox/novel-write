import type { EditorialCollagePipelineData as Document } from './editorial-collage';
import { invalidateSubtitleAlignment } from './audio-alignment';

/** Rebind all automatic slices of a regenerated recording before the ordinary timeline fitter. */
export function rebindRegeneratedSplitNarration(d: Document, selected?: ReadonlySet<string>): Document {
  const all = d.beats.flatMap(b => b.shots);
  const roots = all.filter(s => s.narrationSplit?.sourceShotId === s.id && s.voiceAssetVersionId
    && s.voiceAssetVersionId !== s.narrationSplit.sourceVoiceAssetVersionId && (!selected || selected.has(s.id)));
  if (!roots.length) return d;
  const starts = new Map(d.timeline!.clips.map(c => [c.shotId, c.startMs]));
  const replacements = new Map<string, { durationMs: number; from: number; to: number; total: number; media: number; asset: string; oldDuration: number }>();
  for (const root of roots) {
    const asset = d.assets.find(a => a.id === root.voiceAssetVersionId), media = asset?.durationMs;
    if (!asset || !media || media <= 0) throw new Error('EDITORIAL_NARRATION_DURATION_INVALID: 新旁白缺少实测时长。');
    const group = all.filter(s => s.narrationSplit?.sourceShotId === root.id);
    if (group.some(s => s.voiceAssetVersionId !== asset.id)) throw new Error('EDITORIAL_NARRATION_SPLIT_MISMATCH: 拆镜旁白版本不一致，已停止校时。');
    // Only automatic, untrimmed slices may be retimed without an editing decision.
    for (const shot of group) {
      const speech = (d.timeline?.audioClips ?? []).filter(c => c.shotId === shot.id && ['narration', 'dialogue'].includes(c.trackType));
      const clip = speech[0], oldAsset = d.assets.find(a => a.id === shot.narrationSplit?.sourceVoiceAssetVersionId);
      const start = starts.get(shot.id), from = shot.narrationSplit!.sourceStartMs;
      const expectedDuration = Math.min(shot.durationMs, Math.max(0, (oldAsset?.durationMs ?? 0) - from));
      const automatic = clip && ['narration-clip-' + shot.id, 'legacy-narration-' + shot.id].includes(clip.id);
      if (start === undefined || speech.length !== 1 || !automatic || clip.trackType !== 'narration'
        || clip.assetVersionId !== oldAsset?.id || clip.startMs !== start || clip.muted
        || (clip.sourceStartMs ?? 0) !== from || clip.sourceDurationMs !== expectedDuration
        || clip.durationMs !== expectedDuration || clip.fadeInMs || clip.fadeOutMs || clip.fadeEnvelope) {
        throw new Error('EDITORIAL_NARRATION_SPLIT_MANUAL_EDIT: 拆镜旁白包含手动裁切、偏移或混音，已保留新配音回执，请先确认时间线再校时。');
      }
      const otherEnd = (d.timeline?.audioClips ?? []).filter(c => c.shotId === shot.id && !['narration', 'dialogue', 'music'].includes(c.trackType))
        .reduce((end, c) => Math.max(end, c.startMs - start + (c.durationMs ?? c.sourceDurationMs ?? shot.durationMs)), 0);
      if (otherEnd > 0) throw new Error('EDITORIAL_NARRATION_SPLIT_MANUAL_EDIT: 拆镜包含独立音效，已保留新配音回执，请确认音效时序后再校时。');
    }
    const oldTotal = group.reduce((sum, s) => sum + s.durationMs, 0);
    const total = Math.floor(Math.ceil(media * 24 / 1000) * 1000 / 24);
    let cursor = 0, oldCursor = 0;
    for (let i = 0; i < group.length; i++) {
      const shot = group[i]; oldCursor += shot.durationMs;
      const end = i === group.length - 1 ? total : Math.floor(Math.round(total * oldCursor / oldTotal * 24 / 1000) * 1000 / 24);
      if (end - cursor < 800) throw new Error('EDITORIAL_NARRATION_SPLIT_TOO_SHORT: 新旁白过短，无法安全复用拆镜，请检查配音内容。');
      replacements.set(shot.id, { durationMs: end - cursor, from: Math.min(cursor, media), to: Math.min(end, media), total, media, asset: asset.id, oldDuration: shot.durationMs });
      cursor = end;
    }
  }
  return { ...d,
    beats: d.beats.map(b => ({ ...b, shots: b.shots.map(s => {
      const r = replacements.get(s.id); return r ? { ...s, durationMs: r.durationMs,
        ...(s.animation?.native ? { animation: { ...s.animation, native: { ...s.animation.native, durationMs: r.durationMs, sourceDurationMs: s.animation.native.sourceDurationMs ?? s.animation.native.durationMs } } } : {}),
        camera: s.camera.map(frame => ({ ...frame, atMs: Math.min(r.durationMs, Math.round(frame.atMs * r.durationMs / r.oldDuration)) })),
        layers: s.layers.map(layer => ({ ...layer, motion: layer.motion.map(frame => ({ ...frame, atMs: Math.min(r.durationMs, Math.round(frame.atMs * r.durationMs / r.oldDuration)) })) })),
        narrationSplit: { ...s.narrationSplit!, sourceStartMs: r.from, sourceDurationMs: r.total, sourceVoiceAssetVersionId: r.asset } } : s;
    }), subtitleCues: b.subtitleCues.map(c => {
      const shot = b.shots.find(s => s.subtitleCueIds.includes(c.id)), r = shot && replacements.get(shot.id);
      if (!shot || !r) return c;
      const start = starts.get(shot.id)!;
      const scale = (ms: number) => start + Math.round(Math.min(r.durationMs, Math.max(0, (ms - start) * r.durationMs / r.oldDuration)));
      return invalidateSubtitleAlignment({ ...c, startMs: scale(c.startMs), endMs: scale(c.endMs) }, { audioAssetVersionId: r.asset });
    }) })),
    timeline: { ...d.timeline!, audioClips: (d.timeline?.audioClips ?? []).map(c => {
      const r = c.shotId && replacements.get(c.shotId);
      return r && c.trackType === 'narration' ? { ...c, assetVersionId: r.asset, startMs: starts.get(c.shotId!)!,
        sourceStartMs: r.from, sourceDurationMs: r.to - r.from, durationMs: r.to - r.from, sourceMediaDurationMs: r.media } : c;
    }) },
  };
}
