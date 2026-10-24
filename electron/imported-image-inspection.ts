import { nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { resolvePythonCommand } from '../src/shared/python-runtime';

const inspectBitmap = 'import io,json,sys\nfrom PIL import Image\nwith Image.open(io.BytesIO(sys.stdin.buffer.read())) as image:\n image.load()\n print(json.dumps({"width":image.width,"height":image.height}))';

export async function inspectImportedImage(bytes: Buffer): Promise<{ width: number; height: number }> {
  const native = nativeImage.createFromBuffer(bytes);
  if (!native.isEmpty()) return native.getSize();
  // NativeImage does not decode every supported WebP/GIF variant on Windows.
  return new Promise((resolve, reject) => {
    const child = execFile(resolvePythonCommand(), ['-c', inspectBitmap], { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: 无法读取图片，请选择有效的 PNG、JPG、WEBP 或 GIF。')); return; }
      try {
        const dimensions: unknown = JSON.parse(stdout);
        if (!dimensions || typeof dimensions !== 'object' || !('width' in dimensions) || !('height' in dimensions)
          || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
          || Number(dimensions.width) <= 0 || Number(dimensions.height) <= 0) throw new Error('Invalid image dimensions');
        resolve({ width: Number(dimensions.width), height: Number(dimensions.height) });
      } catch { reject(new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: 图片尺寸无法识别。')); }
    });
    child.stdin?.on('error', () => { /* Decode failure is reported by the process callback. */ });
    child.stdin?.end(bytes);
  });
}
