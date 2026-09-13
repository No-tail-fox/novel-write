import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runStoryboundMediaSidecar, type StoryboundEncodedRenderScene } from '../src/shared/storybound-sidecar';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';

const root = resolve('.');
const sourceRoot = join(root, '.artifacts/compose-xfade-capacity-qa');
const workDir = join(root, '.artifacts/compose-xfade-cancel-qa');
const outputPath = join(workDir, 'prior-output.mp4');
await mkdir(workDir, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
const sentinel = 'preserve-this-output';
await writeFile(outputPath, sentinel, 'utf8');
const otherScratch = join(workDir, 'compose-xfade-groups-other-task-sentinel');
await mkdir(otherScratch, { recursive: true });
await writeFile(join(otherScratch, 'keep.txt'), 'other-task', 'utf8');

const scenes: StoryboundEncodedRenderScene[] = Array.from({ length: 65 }, (_, index) => ({
  segment_path: join(sourceRoot, `source-${index % 2}`, 'segment.mp4'),
  duration_s: 0.5,
  fps: 24,
}));
const controller = new AbortController();
const startedAt = Date.now();
let error = '';
const pending = runStoryboundMediaSidecar({
  mode: 'compose_render',
  work_dir: workDir,
  output_path: outputPath,
  transition: { type: 'fade', duration: 0.125 },
  scenes,
}, { signal: controller.signal, timeoutMs: 120_000 });
setTimeout(() => controller.abort(new DOMException('cancel grouped xfade', 'AbortError')), 2_500);
try {
  await pending;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

const prior = await readFile(outputPath, 'utf8');
const entries = await readdir(workDir);
const scratchDirectories = entries.filter((entry) => entry.startsWith('compose-xfade-groups-'));
const filterFiles = entries.filter((entry) => entry.endsWith('.filter'));
const sourcePath = join(workDir, '_source.mp4');
let sourceExists = true;
try {
  await stat(sourcePath);
} catch {
  sourceExists = false;
}
const report = {
  status: error && prior === sentinel && scratchDirectories.length === 1 && scratchDirectories[0] === 'compose-xfade-groups-other-task-sentinel' && filterFiles.length === 0 && !sourceExists ? 'passed' : 'failed',
  elapsedMs: Date.now() - startedAt,
  error,
  outputPreserved: prior === sentinel,
  scratchDirectories,
  filterFiles,
  sourceExists,
};
await writeFile(join(workDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
if (report.status !== 'passed') throw new Error(JSON.stringify(report));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
