/** Technical benchmark only: renders an unchanged upstream demo, never claims a generated user film. */
import { existsSync } from 'node:fs';
import { app } from 'electron';
import { resolve } from 'node:path';
import { reviewLemoUpstreamProject } from '../electron/lemo-upstream-renderer';
const root = resolve(process.env.STORYDREAM_LEMO_ROOT || process.cwd());
const slug = process.env.STORYDREAM_LEMO_DEMO || 'memphis-diorama';
if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid demo slug');
const outputDir = resolve(root, '.artifacts/lemo-upstream', slug);
app.setPath('userData', resolve(root, '.artifacts/lemo-upstream/electron-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('disable-background-timer-throttling');
void (async () => {
await app.whenReady();
try {
  const receipt = await reviewLemoUpstreamProject({ upstreamRoot: resolve(root, 'vendor/lemo-upstream'),
    filmDir: resolve(root, `vendor/lemo-upstream/styles/${slug}/demo`), threeRoot: resolve(root, 'node_modules/three'),
    resourceRoot: existsSync(resolve(root, '.artifacts/lemo-upstream/resources/resources.json')) ? resolve(root, '.artifacts/lemo-upstream/resources') : undefined,
    outputDir, times: [1, 15, 32], timeoutMs: 110_000 });
  console.log(JSON.stringify({ benchmark: 'unchanged-upstream-demo', receipt }, null, 2));
  app.exit(receipt.technicalPassed ? 0 : 1);
} catch (error) { console.error(error); app.exit(1); }

})().catch(error => { console.error(error); app.exit(1); });

