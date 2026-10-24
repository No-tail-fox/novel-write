import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';

const native = vi.hoisted(() => ({ createFromBuffer: vi.fn(() => ({ isEmpty: () => true, getSize: () => ({ width: 1, height: 1 }) })) }));
vi.mock('electron', () => ({ nativeImage: native }));
import { inspectImportedImage } from '../electron/imported-image-inspection';

afterEach(() => { setDefaultPythonRuntimeAppRoot(undefined); vi.clearAllMocks(); });
describe('imported image inspection', () => {
  it('decodes WebP when the native decoder cannot read it', async () => {
    setDefaultPythonRuntimeAppRoot(resolve('.'));
    const image = await readFile('src/assets/drawing-style-previews/ghibli.webp');
    expect(await inspectImportedImage(image)).toEqual({ width: 768, height: 432 });
  });
  it('rejects damaged image content instead of trusting its header', async () => {
    setDefaultPythonRuntimeAppRoot(resolve('.'));
    const image = await readFile('src/assets/drawing-style-previews/ghibli.webp');
    await expect(inspectImportedImage(image.subarray(0, 32))).rejects.toThrow('IMAGE_LAB_IMPORT_SOURCE_INVALID');
  });
});
