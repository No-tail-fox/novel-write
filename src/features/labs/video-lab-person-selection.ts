import type { VideoReferenceImage } from '../../shared/video-lab';

export function togglePersonReference(
  selected: VideoReferenceImage[],
  reference: VideoReferenceImage,
  remaining: number,
): VideoReferenceImage[] {
  if (selected.some((item) => item.path === reference.path)) {
    return selected.filter((item) => item.path !== reference.path);
  }
  if (selected.length >= Math.max(0, Math.floor(remaining))) return selected;
  return [...selected, reference];
}

export function personReferenceImage(path: string, personName: string): VideoReferenceImage {
  return { path, kind: 'character', description: `人物「${personName}」：保持人物外观、脸型和发型一致。`.slice(0, 500) };
}
