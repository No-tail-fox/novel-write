import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve('.'), artifacts = join(root, '.artifacts/director-transitions-qa');
await mkdir(artifacts, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
const script = await writeStoryboundSidecarScript(artifacts);
const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, [join(root, 'scripts/qa-director-transitions.py'), script, artifacts], {
  cwd: artifacts, timeoutMs: 300_000, maxStdoutBytes: 131072, maxStderrBytes: 65536,
});
if (result.code !== 0) throw new Error(result.stderr);
const report = JSON.parse(result.stdout);
await writeFile(join(artifacts, 'report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
