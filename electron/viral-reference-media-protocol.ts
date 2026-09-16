import { stat } from 'node:fs/promises';
import { resolveReferenceMedia } from '../src/shared/viral-reference-store';
import { htmlVideoMediaResponse, htmlVideoMediaScheme, openHtmlVideoMediaFileResponse } from './html-video-runtime';

const safeId = /^[A-Za-z0-9_-]{1,160}$/;
const allowedMime = /^(?:video\/(?:mp4|webm|quicktime|x-matroska|x-msvideo)|audio\/(?:wav|mpeg|mp4|aac|ogg)|image\/(?:jpeg|png|webp))$/;

export function createViralReferenceMediaUrl(analysisId: string, mediaId: string): string {
  if (!safeId.test(analysisId) || !safeId.test(mediaId)) throw new Error('VIRAL_REFERENCE_MEDIA_ID');
  return `${htmlVideoMediaScheme}://viral/${analysisId}/${mediaId}`;
}

export async function openViralReferenceMediaResponse(
  request: Request,
  resolveWorkDir: (analysisId: string) => Promise<string>,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  if (url.protocol !== `${htmlVideoMediaScheme}:` || url.hostname !== 'viral' || url.username || url.password
    || url.port || url.search || url.hash || segments.length !== 3
    || !safeId.test(segments[1]) || !safeId.test(segments[2])) throw new Error('VIRAL_REFERENCE_MEDIA_URL');
  if (request.method !== 'GET' && request.method !== 'HEAD') return htmlVideoMediaResponse(null, { status: 405 });
  const workDir = await resolveWorkDir(segments[1]);
  const media = await resolveReferenceMedia(workDir, segments[2]);
  if (!allowedMime.test(media.mime)) throw new Error('VIRAL_REFERENCE_MEDIA_TYPE');
  const file = await stat(media.path, { bigint: true });
  const response = await openHtmlVideoMediaFileResponse(media.path, {
    canonicalPath: media.path,
    device: String(file.dev),
    inode: String(file.ino),
    size: String(file.size),
    modifiedNs: String(file.mtimeNs),
  }, request.headers.get('range'));
  try {
    // Recheck ownership after opening; the response streams from the pinned handle.
    const checked = await resolveReferenceMedia(workDir, segments[2]);
    if (checked.path !== media.path || checked.mime !== media.mime) throw new Error('VIRAL_REFERENCE_MEDIA_CHANGED');
    const headers = new Headers(response.headers);
    headers.set('Content-Type', media.mime);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'");
    if (request.method === 'HEAD') await response.body?.cancel();
    return htmlVideoMediaResponse(request.method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}
