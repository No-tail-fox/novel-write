import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createViralReferenceMediaUrl, openViralReferenceMediaResponse } from '../electron/viral-reference-media-protocol';
import { registerReferenceMedia } from '../src/shared/viral-reference-store';

describe('managed viral reference media protocol', () => {
  it('streams bounded byte ranges and HEAD from a DB-selected managed media ID', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'storydream-reference-protocol-')));
    try {
      const video = join(directory, 'source.mp4');
      await writeFile(video, Buffer.from('0123456789'));
      await registerReferenceMedia(directory, 'source', video, 'video/mp4');
      const url = createViralReferenceMediaUrl('analysis-1', 'source');
      const resolveWorkDir = async (id: string) => { expect(id).toBe('analysis-1'); return directory; };
      const response = await openViralReferenceMediaResponse(new Request(url, { headers: { range: 'bytes=3-6' } }), resolveWorkDir);
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe('bytes 3-6/10');
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(await response.text()).toBe('3456');
      const head = await openViralReferenceMediaResponse(new Request(url, { method: 'HEAD' }), resolveWorkDir);
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe('10');
      expect(await head.text()).toBe('');
      const invalidRange = await openViralReferenceMediaResponse(new Request(url, { headers: { range: 'bytes=10-' } }), resolveWorkDir);
      expect(invalidRange.status).toBe(416);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects arbitrary paths, credential URLs and unregistered media', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'storydream-reference-protocol-invalid-')));
    try {
      expect(() => createViralReferenceMediaUrl('analysis-1', '../source.mp4')).toThrow();
      for (const value of [
        'storydream-media://viral/analysis-1/source?path=C:/secret.txt',
        'storydream-media://viral/analysis-1/%2e%2e%2fsecret',
        'storydream-media://viral/analysis-1/source/extra',
      ]) {
        await expect(openViralReferenceMediaResponse(new Request(value), async () => directory)).rejects.toThrow();
      }
      await expect(openViralReferenceMediaResponse(new Request(createViralReferenceMediaUrl('analysis-1', 'missing')), async () => directory)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
