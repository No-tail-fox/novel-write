import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  editorialQaCaptureIds,
  editorialQaExpectedCaptureCount,
  editorialQaScopes,
  resolveEditorialQaConfig,
  type EditorialQaEnvironment,
} from '../electron/editorial-qa';

describe('editorial Electron QA configuration', () => {
  it('requires the complete QA environment and rejects smoke mode', () => {
    expect(() => resolveEditorialQaConfig({
      STORYDREAM_QA_RUN_ROOT: 'C:\\temp\\root',
    }, tmpdir())).toThrow('all-or-none');
    expect(() => resolveEditorialQaConfig({
      STORYDREAM_QA_RUN_ROOT: 'C:\\temp\\root',
      STORYDREAM_QA_RUN_TOKEN: 'token',
      STORYDREAM_QA_SENTINEL: 'C:\\temp\\root\\sentinel',
      STORYDREAM_QA_USER_DATA: 'C:\\temp\\root\\user-data',
      STORYDREAM_QA_REPORT: 'C:\\temp\\root\\user-data\\report.json',
      STORYDREAM_QA_CAPTURES: 'C:\\temp\\root\\user-data\\captures',
      STORYDREAM_SMOKE_OUTPUT: 'C:\\temp\\root\\user-data\\smoke.json',
      STORYDREAM_SMOKE_USER_DATA: 'C:\\temp\\root\\user-data',
    }, tmpdir())).toThrow('mutually exclusive');
  });

  it('only accepts known capture scopes before Electron is launched', () => {
    expect(editorialQaScopes).toEqual(['all', 'theme-smoke', 'shell', 'new-task', 'task-operations', 'html-video', 'clone-voice', 'workflow', 'labs', 'system']);
    expect(() => resolveEditorialQaConfig({ STORYDREAM_QA_SCOPE: 'unknown' }, tmpdir())).toThrow('Unknown editorial QA scope');
  });

  it('defines the exact completed capture count for every QA scope', () => {
    expect(Object.fromEntries(editorialQaScopes.map((scope) => [scope, editorialQaExpectedCaptureCount(scope)]))).toEqual({
      all: 86,
      'theme-smoke': 4,
      shell: 4,
      'new-task': 4,
      'task-operations': 4,
      'html-video': 2,
      'clone-voice': 4,
      workflow: 28,
      labs: 20,
      system: 20,
    });
    for (const scope of editorialQaScopes) {
      const ids = editorialQaCaptureIds(scope);
      expect(new Set(ids).size, `${scope} capture ids`).toBe(ids.length);
    }
  });

  it('captures the four accepted new-task states without multiplying unrelated themes and viewports', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    for (const state of [
      "{ id: 'new-task-material-desktop', view: 'new-task', stage: 'material', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-creative-desktop', view: 'new-task', stage: 'creative', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-output-desktop', view: 'new-task', stage: 'output', theme: 'light', viewport: 'desktop' }",
      "{ id: 'new-task-material-compact', view: 'new-task', stage: 'material', theme: 'light', viewport: 'compact' }",
    ]) {
      expect(source).toContain(state);
    }
    expect(source).toContain("document.querySelector('[data-new-task-stage-tab=\"' + stage + '\"]')");
    expect(source).toContain('stageStatePreserved = reopenedTitle instanceof HTMLInputElement');
    expect(source).toContain("button.textContent?.trim() === '手动封面'");
    expect(source).toContain("document.querySelector('[data-manual-cover-state=\"required\"]')");
    expect(source).toContain("state.manualCover.state !== 'required'");
    expect(source).toContain('!state.manualCover.importVisible');
    expect(source).toContain('!state.manualCover.createDisabled');
    expect(source).toContain('horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)');
    expect(source).toContain("const expectedPlacement = viewport.name === 'compact' ? 'below' : 'right';");
    expect(source).toContain('editorialQaOperationTimeoutMs');
    expect(source).toContain('withEditorialQaTimeout(');
    expect(source).toContain('activeCapture: captureCase.id');
    expect(source).toContain('const initialShellReady = await waitFor');
    expect(source).toContain('theme preference timed out');
    expect(source).toContain('font readiness timed out');
    expect(source).toContain('qaCompositorSettlingScript()');
    expect(source).toContain('fallback = setTimeout(finish, 160)');
    expect(source).toContain('requestAnimationFrame(() => requestAnimationFrame(finish))');
    expect(source).toContain('captureEditorialQaPage(window, captureCase.id)');
    expect(source).toContain('capturePage failed after 3 attempts');
    expect(source).toContain('Editorial QA ${label} failed:');
  });

  it('exercises MiniMax clone-voice CRUD across both themes and viewports', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    expect(editorialQaCaptureIds('clone-voice')).toEqual([
      'minimax-clone-voice-create-light-desktop',
      'minimax-clone-voice-edit-dark-desktop',
      'minimax-clone-voice-delete-light-compact',
      'minimax-clone-voice-empty-dark-compact',
    ]);
    expect(source).toContain("button.textContent?.includes('登记音色')");
    expect(source).toContain("sourceButton instanceof HTMLButtonElement");
    expect(source).toContain("inputs[2].value.endsWith('qa-minimax-source.wav')");
    expect(source).toContain("button.textContent?.includes('保存记录')");
    expect(source).toContain('button[title="编辑音色记录"]');
    expect(source).toContain('button[title="确认删除音色记录"]');
    expect(source).toContain('.minimax-clone-voice-manager button');
    expect(source).toContain("scrollIntoView({ block: 'center', inline: 'nearest' })");
    const styles = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain(":root[data-theme='light'] .settings-content .provider-profile-card");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .provider-config-note");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .ghost-action");
    expect(styles).toContain(":root[data-theme='light'] .settings-content .segmented button.selected");
  });

  it('keeps the real Electron capture contract on native capturePage and deterministic matrices', async () => {
    const harness = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');
    const main = await (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const shell = await (await import('node:fs/promises')).readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8');
    expect(harness).toContain('mkdtemp(join(tmpdir(), \'storydream-editorial-qa-\'))');
    expect(harness).toContain('STORYDREAM_QA_RUN_TOKEN');
    expect(harness).toContain('runBoundedProcess');
    expect(harness).toContain('const timeoutMs = 420_000;');
    expect(harness).toContain('partialEditorialQaProgress');
    expect(harness).toContain('partial capture progress');
    expect(harness).toContain('Active capture:');
    expect(harness).toContain('editorialQaExpectedCaptureCount(scope)');
    expect(harness).toContain('qaReport.activeCapture !== null');
    expect(harness).toContain('incomplete capture report');
    expect(harness).not.toMatch(/taskkill\s+\/IM|playwright|puppeteer/u);
    expect(main).toContain('force-device-scale-factor');
    expect(main).toContain('useContentSize: true');
    expect(main).toContain('backgroundThrottling: !editorialQaConfig');
    expect(main).toContain('captureEditorialQa');
    expect(main).toContain("editorialQaConfig?.scope !== 'workflow'");
    expect(shell).toContain('data-nav-view={newTaskPrimaryAction.view}');
    expect(await (await import('node:fs/promises')).readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8')).toContain('await writeEditorialQaReport');
  });

  it('keeps editable form text readable in both shell themes', async () => {
    const styles = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('background: var(--surface-ink);');
    expect(styles).toContain('color: var(--text);');
  });

  it('accepts a parent-created temp root and consumes its regular sentinel once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-editorial-qa-test-'));
    const sentinel = join(root, '.editorial-qa-sentinel');
    const userData = join(root, 'user-data');
    const report = join(userData, 'report.json');
    const captures = join(userData, 'captures');
    const token = 'a'.repeat(32);
    await mkdir(userData);
    await writeFile(sentinel, token, { flag: 'wx' });
    const env: EditorialQaEnvironment = {
      STORYDREAM_QA_RUN_ROOT: root,
      STORYDREAM_QA_RUN_TOKEN: token,
      STORYDREAM_QA_SENTINEL: sentinel,
      STORYDREAM_QA_USER_DATA: userData,
      STORYDREAM_QA_REPORT: report,
      STORYDREAM_QA_CAPTURES: captures,
      STORYDREAM_QA_SCOPE: 'shell',
    };

    try {
      const config = resolveEditorialQaConfig(env, tmpdir());
      expect(config).toMatchObject({ root, sentinel, userData, report, captures, scope: 'shell' });
      expect(() => resolveEditorialQaConfig(env, tmpdir())).toThrow('sentinel');
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(root, { recursive: true, force: true });
    }
  });
});
