import type { IpcChannel } from '../src/shared/ipc-contract';

const generationChannels = new Set<IpcChannel>([
  'task:create-and-run', 'task:retry', 'task:regenerate-image', 'task:regenerate-images', 'task:reference-edit-image',
  'task:regenerate-narration', 'viral:create-and-run', 'viral:analyze-prepared', 'viral:retry',
  'viral:create-production-task', 'image-lab:generate', 'voice-lab:generate', 'video-lab:generate',
  'music-lab:generate', 'music-lab:lyrics', 'music-lab:boost-style', 'music-lab:operation', 'music-lab:upload-source',
  'custom-style:generate-draft', 'custom-style:generate-preview', 'research:compose-copy', 'vox:generate',
  'motion-comic:plan', 'motion-comic:plan-episodes', 'motion-comic:scripts-enqueue', 'motion-comic:scripts-storyboard',
  'vox-production:start', 'director:generate-shot-video',
  'html-video:create-task', 'html-video:add-asset', 'html-video:regenerate-asset', 'html-video:regenerate-voice', 'html-video:regenerate-cover',
  'director:recheck-subtitles', 'director:review-artifact',
]);

export function needsLicense(channel: IpcChannel, input: unknown): boolean {
  if (channel === 'task:rerun-step') return (input as { step?: number } | undefined)?.step !== 6;
  if (generationChannels.has(channel)) return true;
  const control = input as { status?: string; action?: string } | undefined;
  if (channel === 'task:update-status' || channel === 'viral:update-status') return control?.status === 'running';
  if (channel === 'motion-comic:scripts-control' || channel === 'vox-production:control') return control?.action === 'resume';
  if (channel === 'music-lab:enhanced') return control?.action === 'submit';
  if (channel === 'music-lab:voice') return ['validate', 'verify', 'generate', 'regenerate'].includes(control?.action ?? '');
  return false;
}
