import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runPixelleWorker } from '../src/shared/pixelle-worker';
import { renderPixelleFrameWithResources } from '../src/shared/pixelle-resources';

const appRoot = resolve('.');
const workDir = join(appRoot, '.artifacts', 'pixelle-templates-smoke');
await mkdir(workDir, { recursive: true });
const imagePath = join(appRoot, '.artifacts', 'short-video-dual-output-smoke', 'still.png');
await readFile(imagePath); // Existing technical fixture; never a user project or sample.
const catalog = await runPixelleWorker({ mode: 'catalog', workDir }, { appRoot });
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const results: Array<Record<string, unknown>> = [];
for (const template of catalog.templates.filter(item => !only || item.ref.path === only)) {
  const started = Date.now();
  try {
    const result = await renderPixelleFrameWithResources({
      mode: 'render-frame', workDir, templateRef: template.ref,
      title: '原版模板渲染验证', text: '配音决定节奏，程序负责时间轴。原版画面与字体完整保留。',
      imagePath: template.type === 'static' ? undefined : imagePath,
      mediaKind: template.type === 'video' ? 'video' : 'image',
      output: template.ref.path.replace(/\.html$/, '.png'),
    }, {
      cacheDir: join(workDir, 'resources'), template,
      render: request => runPixelleWorker(request, { appRoot }),
    });
    const bytes = await readFile(result.path);
    if (bytes.readUInt32BE(16) !== template.width || bytes.readUInt32BE(20) !== template.height) throw new Error('PNG dimensions mismatch');
    results.push({ template: template.ref.path, status: 'passed', ...result, elapsedMs: Date.now() - started });
    console.log('PASS', template.ref.path, result.kind);
  } catch (error) {
    results.push({ template: template.ref.path, status: 'failed', error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started });
    console.log('FAIL', template.ref.path, results.at(-1)?.error);
  }
  await writeFile(join(workDir, 'report.json'), JSON.stringify({ status: 'running', paidRequests: 0, results }, null, 2), 'utf8');
}
const status = results.length > 0 && results.every(item => item.status === 'passed') ? 'passed' : 'failed';
await writeFile(join(workDir, 'report.json'), JSON.stringify({ status, revision: catalog.revision, paidRequests: 0, results }, null, 2), 'utf8');
console.log(status, results.length, 'templates; paidRequests=0');
process.exitCode = status === 'passed' ? 0 : 1;