/** Local, no-paid inspection of an already generated Lemo project: renders sample stills and reports problems. */
import { app } from 'electron';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultLemoUpstreamPythonRoot } from '../electron/lemo-upstream-video';
import { reviewLemoUpstreamProject } from '../electron/lemo-upstream-renderer';

const root = resolve(process.env.STORYDREAM_LEMO_ROOT || process.cwd());
const filmDir = resolve(process.env.STORYDREAM_LEMO_REVIEW_FILM || '');
const outputDir = resolve(process.env.STORYDREAM_LEMO_REVIEW_OUT || join(filmDir, '..', 'review-out'));
const durationSeconds = Number(process.env.STORYDREAM_LEMO_REVIEW_DURATION || '15');
app.on('window-all-closed', () => {});
app.setPath('userData', join(outputDir, 'electron-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

async function main() {
  await app.whenReady();
  setDefaultPythonRuntimeAppRoot(root);
  const upstreamRoot = join(root, 'vendor/lemo-upstream');
  const library = { upstreamRoot, pythonRoot: defaultLemoUpstreamPythonRoot(upstreamRoot), threeRoot: join(root, 'node_modules/three'), cacheDir: join(outputDir, 'cache'),
    ...(existsSync(join(root, '.artifacts/lemo-upstream/resources/resources.json')) ? { resourceRoot: join(root, '.artifacts/lemo-upstream/resources') } : {}) };
  await mkdir(outputDir, { recursive: true });
  const times = [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, durationSeconds - 0.05];
  const receipt = await reviewLemoUpstreamProject({ ...library, filmDir, outputDir, times, durationSeconds, width: 1920, height: 1080 });
  await writeFile(join(outputDir, 'review-summary.json'), JSON.stringify(receipt, null, 2), 'utf8');
  console.log(JSON.stringify({ event: 'review', filmDir, outputDir, frames: receipt.frames?.length ?? 0, errors: receipt.errors, missingResources: receipt.missingResources?.length ?? 0 }));
  app.exit(receipt.errors.length ? 1 : 0);
}
void main().catch(error => { console.error(error); app.exit(1); });
