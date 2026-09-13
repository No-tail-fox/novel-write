import type { DirectorAudioDocument } from '../../shared/director-audio-edit';
import { directorEditableAudioClips } from '../../shared/director-audio-edit';
import type { ProductionAudioClip } from '../../shared/production-audio';
import { toLocalAssetUrl } from '../tasks/task-formatters';

export interface DirectorSoundClip extends ProductionAudioClip {
  title: string;
  available: boolean;
}

export function directorSoundClips(document: DirectorAudioDocument, shotId: string): DirectorSoundClip[] {
  return directorEditableAudioClips(document, shotId).map((clip) => {
    const asset = document.assets.find((item) => item.id === clip.assetVersionId && item.kind === 'audio');
    return { ...clip, title: asset?.prompt || '音频片段', available: Boolean(asset?.localPath) };
  });
}

/** Probe the managed copy before accepting a sound into the project. */
export function readDirectorSoundDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const finish = (error?: Error) => {
      const durationMs = Math.round(audio.duration * 1000);
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      if (error) reject(error);
      else if (!Number.isFinite(durationMs) || durationMs <= 0) reject(new Error('无法读取音频时长，请选择有效的音频文件。'));
      else resolve(durationMs);
    };
    const timer = setTimeout(() => finish(new Error('读取音频超时，请检查文件后重试。')), 15000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error('音频无法解码，请选择 MP3、WAV 或其他支持的音频文件。'));
    audio.src = toLocalAssetUrl(path);
  });
}
