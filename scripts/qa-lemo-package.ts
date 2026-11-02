import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { probeOfficialLemoAgentRuntime } from '../electron/lemo-agent-runtime';
import { probeLemoRelease, resolvePackagedLemoRelease } from '../electron/lemo-official-release';

const resources = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: qa-lemo-package <resources> <output>');
await mkdir(output, { recursive: true });
const release = await resolvePackagedLemoRelease(resources);
if ((await realpath(process.execPath)).toLowerCase() !== (await realpath(release.nodeExecutable)).toLowerCase()) {
  throw new Error('LEMO_PACKAGE_QA_MUST_RUN_BUNDLED_NODE');
}
if (process.env.PATH !== dirname(release.nodeExecutable)) throw new Error('LEMO_PACKAGE_QA_PATH_NOT_ISOLATED');
await probeLemoRelease(release);
const upstreamRoot = join(resources, 'lemo-upstream');
const result = await probeOfficialLemoAgentRuntime({ nodeExecutable: release.nodeExecutable, workerPath: release.workerPath,
  upstreamRoot, runRoot: join(output, 'worker-probe'), timeoutMs: 90000 });
if (result.sdkVersion !== '0.3.314' || result.cliVersion !== '2.1.314' || result.paidRequests !== 0 || result.outboundRequestsBlocked !== 0) {
  throw new Error('LEMO_PACKAGE_QA_INVALID_PROBE');
}
const systemGitBash = join(process.env.SystemDrive || 'C:', 'Program Files/Git/bin/bash.exe');
const systemGitPresent = await stat(systemGitBash).then(value => value.isFile(), () => false);
const report = { schema: 1, status: 'passed', completedAt: new Date().toISOString(), resources, executable: process.execPath,
  nodeVersion: process.version, manifestSha256: release.manifestSha256, fileCount: release.manifest.files.length,
  totalBytes: release.manifest.files.reduce((sum, item) => sum + item.size, 0),
  sdkVersion: result.sdkVersion, cliVersion: result.cliVersion, plugin: result.plugin, skills: result.skills,
  paidRequests: 0, outboundRequestsBlocked: 0, globalNodeRequired: false, inheritedNodePath: !!process.env.NODE_PATH,
  searchPath: process.env.PATH, defaultSystemGitBashPresent: systemGitPresent,
  gitBashPolicy: 'explicit-unavailable-path', globalGitBashRequired: false, cleanMachineVerified: false,
  limitations: ['Local isolated runtime execution is not a clean Windows installation acceptance test.',
    'The controlled worker disables global Bash discovery; this is not an OS sandbox or a general shell execution capability.'] };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report));
