import { join, resolve } from 'node:path';

export function getRendererIndexPath(mainDir: string): string {
  return resolve(mainDir, '..', '..', 'dist-renderer', 'index.html');
}
