import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  editorialQaCaptureIdsByRequirement,
  editorialQaExpectedCaptureCount,
  editorialQaScopes,
  resolveEditorialQaConfig,
  type EditorialQaCapture,
  type EditorialQaScope,
} from '../electron/editorial-qa';
import { redactProcessOutput, runBoundedProcess } from '../src/shared/process-runner';
import { formatSmokeError, runSmokeWithTempRoot, setSmokeFailureExitCode } from './smoke-signal-lifecycle';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const timeoutMs = 420_000;
const maxOutputBytes = 1024 * 1024;

interface QaReport {
  scope: string;
  processId: number;
  ownedProcessIds: number[];
  remainingOwnedProcessIds: number[];
  activeCapture?: string | null;
  captures: EditorialQaCapture[];
}

async function main(): Promise<void> {
  const scope = readScope(process.argv.slice(2));
  const require = createRequire(join(rootDir, 'package.json'));
  const electronPath = require('electron') as string;
  let artifactDirectory = '';
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(tmpdir(), 'storydream-editorial-qa-')),
    run: async ({ tempRoot, signal }) => {
      const userData = join(tempRoot, 'user-data');
      const sentinel = join(tempRoot, '.editorial-qa-sentinel');
      const report = join(userData, 'editorial-qa-report.json');
      const captures = join(userData, 'captures');
      const token = randomBytes(32).toString('hex');
      await mkdir(userData, { recursive: true });
      await writeFile(sentinel, token, { encoding: 'utf8', flag: 'wx' });
      const qaEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'production',
        VITE_DEV_SERVER_URL: '',
        STORYDREAM_QA_RUN_ROOT: tempRoot,
        STORYDREAM_QA_RUN_TOKEN: token,
        STORYDREAM_QA_SENTINEL: sentinel,
        STORYDREAM_QA_USER_DATA: userData,
        STORYDREAM_QA_REPORT: report,
        STORYDREAM_QA_CAPTURES: captures,
        STORYDREAM_QA_SCOPE: scope,
      };
      if (scope === 'jianying') {
        const localAppData = join(tempRoot, 'local-app-data');
        const userDataRoot = join(localAppData, 'JianyingPro', 'User Data');
        const standardDraftRoot = join(userDataRoot, 'Projects', 'com.lveditor.draft');
        const draftRoot = join(tempRoot, 'configured-draft-root');
        await mkdir(join(standardDraftRoot, 'Decoy standard draft'), { recursive: true });
        await mkdir(join(draftRoot, 'QA draft one'), { recursive: true });
        await mkdir(join(draftRoot, 'QA draft two'), { recursive: true });
        await mkdir(join(userDataRoot, 'Config'), { recursive: true });
        await writeFile(
          join(userDataRoot, 'Config', 'globalSetting'),
          `[General]\ncurrentCustomDraftPath=${draftRoot.replace(/\\/gu, '\\\\')}\n`,
          'utf8',
        );
        qaEnvironment.LOCALAPPDATA = localAppData;
      }
      delete qaEnvironment.ELECTRON_RUN_AS_NODE;
      delete qaEnvironment.STORYDREAM_SMOKE_OUTPUT;
      delete qaEnvironment.STORYDREAM_SMOKE_USER_DATA;
      // Parent-side parsing rejects an invalid scope before Electron is spawned.
      resolveEditorialQaConfig({
        ...qaEnvironment,
        STORYDREAM_QA_SENTINEL: sentinel,
      });
      // Recreate the consumed one-use sentinel after validation; the child consumes it for real.
      await writeFile(sentinel, token, { encoding: 'utf8', flag: 'wx' });
      let child: Awaited<ReturnType<typeof runBoundedProcess>>;
      try {
        child = await runBoundedProcess(electronPath, ['.'], {
          cwd: rootDir,
          env: qaEnvironment,
          signal,
          timeoutMs,
          maxStdoutBytes: maxOutputBytes,
          maxStderrBytes: maxOutputBytes,
        });
      } catch (error) {
        const progress = await partialEditorialQaProgress(report);
        if (progress) {
          const lastCapture = progress.lastCapture ? ` Last capture: ${progress.lastCapture}.` : '';
          const activeCapture = progress.activeCapture ? ` Active capture: ${progress.activeCapture}.` : '';
          throw new Error(`Editorial QA child did not complete; partial capture progress: ${progress.captureCount} captures.${lastCapture}${activeCapture} ${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
      }
      if (child.code !== 0) {
        const detail = redactProcessOutput(child.stderr).trim().slice(-4000);
        throw new Error(`Editorial QA Electron child ${child.pid} exited with ${child.code ?? child.signal}.${detail ? `\n${detail}` : ''}`);
      }
      if (!existsSync(report)) {
        const detail = redactProcessOutput(`${child.stdout}\n${child.stderr}`).trim().slice(-4000);
        throw new Error(`Editorial QA Electron child ${child.pid} exited without a report.${detail ? `\n${detail}` : ''}`);
      }
      const qaReport = JSON.parse(await readFile(report, 'utf8')) as QaReport;
      const remaining = await remainingOwnedProcesses(qaReport.ownedProcessIds, 5_000);
      if (qaReport.processId <= 0 || qaReport.remainingOwnedProcessIds.length || remaining.length) {
        throw new Error(`Editorial QA left owned processes alive: ${remaining.join(', ') || qaReport.remainingOwnedProcessIds.join(', ')}`);
      }
      const expectedCaptureCount = editorialQaExpectedCaptureCount(scope);
      const uniqueCaptureCount = new Set(qaReport.captures.map((capture) => capture.path)).size;
      if (
        qaReport.scope !== scope
        || qaReport.captures.length !== expectedCaptureCount
        || uniqueCaptureCount !== expectedCaptureCount
        || qaReport.activeCapture !== null
      ) {
        const detail = redactProcessOutput(`${child.stdout}\n${child.stderr}`).trim().slice(-4000);
        throw new Error(
          `Editorial QA incomplete capture report for ${scope}: expected ${expectedCaptureCount}, received ${qaReport.captures.length}, unique ${uniqueCaptureCount}, active ${qaReport.activeCapture ?? 'none'}.${detail ? `\n${detail}` : ''}`,
        );
      }
      validateCanonicalEvidence(qaReport);
      validateMediaThemeInvariants(qaReport);
      if (scope === 'theme-smoke') validateThemeSmoke(qaReport);
      artifactDirectory = await mkdtemp(join(tmpdir(), 'storydream-editorial-artifacts-'));
      await copyFile(report, join(artifactDirectory, 'report.json'));
      await mkdir(join(artifactDirectory, 'captures'));
      for (const capture of qaReport.captures) {
        if (basename(capture.path) !== capture.path) throw new Error('Editorial QA report contains an unsafe capture name.');
        await copyFile(join(captures, capture.path), join(artifactDirectory, 'captures', capture.path));
      }
    },
    cleanup: async (tempRoot) => {
      if (process.env.STORYDREAM_EDITORIAL_KEEP_TEMP === '1') {
        process.stderr.write(`Editorial QA kept temp root: ${tempRoot}\n`);
        return;
      }
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5 });
    },
  });
  process.stdout.write(`Editorial QA artifacts: ${artifactDirectory}\n`);
}

function validateCanonicalEvidence(report: QaReport): void {
  const requiredCaptures = report.captures.filter((capture) => capture.requirement === 'required');
  if (report.scope === 'all') {
    const expectedRequired = editorialQaCaptureIdsByRequirement('required');
    const expectedSupplemental = editorialQaCaptureIdsByRequirement('supplemental');
    const actualRequired = new Set(requiredCaptures.map((capture) => capture.id));
    const actualSupplemental = new Set(report.captures.filter((capture) => capture.requirement === 'supplemental').map((capture) => capture.id));
    if (
      actualRequired.size !== expectedRequired.length
      || actualSupplemental.size !== expectedSupplemental.length
      || expectedRequired.some((id) => !actualRequired.has(id))
      || expectedSupplemental.some((id) => !actualSupplemental.has(id))
    ) {
      throw new Error(`Editorial QA canonical classification is incomplete: ${actualRequired.size} required, ${actualSupplemental.size} supplemental.`);
    }
  }
  const invalid = requiredCaptures.filter((capture) => (
    !capture.evidence?.identity.matched
    || capture.evidence.identity.meaningfulTextLength < 20
    || capture.evidence.identity.rootChildCount < 1
    || !capture.evidence.interaction.performed
    || !capture.evidence.interaction.verified
    || Object.values({
      ...capture.evidence.runtime,
      ...capture.evidence.content,
      iconOnlyAccessibleNameGaps: capture.evidence.accessibility.iconOnlyAccessibleNameGaps,
      iconOnlyTooltipGaps: capture.evidence.accessibility.iconOnlyTooltipGaps,
      textContrastFailures: capture.evidence.accessibility.textContrastFailures,
      focusContrastFailures: capture.evidence.accessibility.focusContrastFailures,
      interactiveOverlaps: capture.evidence.layout.interactiveOverlaps,
      mediaFailures: capture.evidence.media.failures,
    }).some((values) => values.length > 0)
    || capture.evidence.media.bitmaps.length !== capture.evidence.media.regions.length
    || capture.evidence.media.bitmaps.some((bitmap) => (
      !/^[a-f0-9]{64}$/u.test(bitmap.sha256)
      || !Number.isFinite(bitmap.pixelVariance)
      || bitmap.pixelVariance < 0
      || bitmap.width < 16
      || bitmap.height < 16
    ))
  ));
  if (invalid.length > 0) {
    throw new Error(`Editorial QA required evidence is incomplete: ${invalid.map((capture) => capture.id).join(', ')}.`);
  }
}

function validateMediaThemeInvariants(report: QaReport): void {
  const byId = new Map(report.captures.map((capture) => [capture.id, capture]));
  for (const darkCapture of report.captures.filter((capture) => capture.theme === 'dark')) {
    const lightCapture = byId.get(darkCapture.id.replace('-dark-', '-light-'));
    if (!lightCapture) continue;
    const darkBitmaps = darkCapture.evidence.media.bitmaps;
    const lightBitmaps = lightCapture.evidence.media.bitmaps;
    if (darkBitmaps.length !== lightBitmaps.length) {
      throw new Error(`Editorial media bitmap set changed across themes: ${darkCapture.id}.`);
    }
    const lightByKey = new Map(lightBitmaps.map((bitmap) => [bitmap.key, bitmap]));
    for (const darkBitmap of darkBitmaps) {
      const lightBitmap = lightByKey.get(darkBitmap.key);
      const themeAwareEditorCanvas = darkCapture.view === 'draft-templates' && darkBitmap.kind === 'draft-canvas';
      if (
        !lightBitmap
        || darkBitmap.kind !== lightBitmap.kind
        || darkBitmap.width !== lightBitmap.width
        || darkBitmap.height !== lightBitmap.height
        || (!themeAwareEditorCanvas && darkBitmap.sha256 !== lightBitmap.sha256)
      ) {
        throw new Error(`Editorial media bitmap changed across themes: ${darkCapture.id} ${darkBitmap.key}.`);
      }
    }
  }
}

function validateThemeSmoke(report: QaReport): void {
  const light = report.captures.find((capture) => capture.theme === 'light');
  const dark = report.captures.find((capture) => capture.theme === 'dark');
  if (!light || !dark) throw new Error('Editorial theme smoke requires light and dark captures.');
  const unstable = report.captures.filter((capture) => (
    !capture.themeTransition.performed
    || !capture.themeTransition.forwardStable
    || !capture.themeTransition.backwardStable
    || capture.themeTransition.mismatchCount > 0
    || capture.themeTransition.reversalCount > 0
  ));
  if (unstable.length > 0) {
    throw new Error(`Editorial theme transition was unstable: ${unstable.map((capture) => capture.id).join(', ')}.`);
  }
  const unstableHovers = report.captures.filter((capture) => {
    const hover = capture.themeHover;
    return !hover
      || !hover.performed
      || !hover.shellVisibleThroughout
      || !hover.buttonBoundsStable
      || !hover.nativeTitlePresent
      || hover.tooltipMechanismCount !== 1
      || hover.roleTooltipCount !== 0
      || hover.blankFrameCount > 0
      || hover.frameVariances.length !== 6
      || hover.rootThemes.some((theme) => theme !== capture.theme)
      || hover.providerThemes.some((theme) => theme !== capture.theme);
  });
  if (unstableHovers.length > 0) {
    throw new Error(`Editorial theme hover was unstable: ${unstableHovers.map((capture) => `${capture.id} ${JSON.stringify(capture.themeHover)}`).join(', ')}.`);
  }
  for (const name of ['--shell-bg', '--shell-surface', '--shell-border', '--shell-text', '--shell-muted']) {
    if (!light.tokens[name] || !dark.tokens[name] || light.tokens[name] === dark.tokens[name]) {
      throw new Error(`Editorial shell token did not change across themes: ${name}`);
    }
  }
  for (const name of ['--media-bg', '--media-surface', '--media-border', '--media-text', '--media-muted']) {
    if (!light.tokens[name] || light.tokens[name] !== dark.tokens[name]) {
      throw new Error(`Editorial media token changed across themes: ${name}`);
    }
  }
}

function readScope(args: readonly string[]): EditorialQaScope {
  const values = args.filter((value) => value.startsWith('--scope='));
  if (args.length !== values.length || values.length > 1) throw new Error('Usage: editorial-qa-electron.ts [--scope=<scope>]');
  const scope = values[0]?.slice('--scope='.length) || 'all';
  if (!editorialQaScopes.includes(scope as (typeof editorialQaScopes)[number])) {
    throw new Error(`Unknown editorial QA scope: ${scope}`);
  }
  return scope as EditorialQaScope;
}

async function partialEditorialQaProgress(reportPath: string): Promise<{ captureCount: number; lastCapture: string | null; activeCapture: string | null } | null> {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as QaReport;
    const lastCapture = report.captures.at(-1)?.path ?? null;
    return { captureCount: report.captures.length, lastCapture, activeCapture: report.activeCapture ?? null };
  } catch {
    return null;
  }
}

async function remainingOwnedProcesses(pids: readonly number[], timeoutMs: number): Promise<number[]> {
  const unique = [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  let remaining = unique.filter(isProcessAlive);
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    remaining = unique.filter(isProcessAlive);
  }
  return remaining;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(`${formatSmokeError(error)}\n`);
  setSmokeFailureExitCode(process);
});
