import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
    expect(editorialQaScopes).toEqual(['all', 'shell', 'workflow', 'labs', 'system']);
    expect(() => resolveEditorialQaConfig({ STORYDREAM_QA_SCOPE: 'unknown' }, tmpdir())).toThrow('Unknown editorial QA scope');
  });

  it('keeps the real Electron capture contract on native capturePage and deterministic matrices', async () => {
    const harness = await (await import('node:fs/promises')).readFile(new URL('../scripts/editorial-qa-electron.ts', import.meta.url), 'utf8');
    const main = await (await import('node:fs/promises')).readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(harness).toContain('mkdtemp(join(tmpdir(), \'storydream-editorial-qa-\'))');
    expect(harness).toContain('STORYDREAM_QA_RUN_TOKEN');
    expect(harness).toContain('runBoundedProcess');
    expect(harness).not.toMatch(/taskkill\s+\/IM|playwright|puppeteer/u);
    expect(main).toContain('force-device-scale-factor');
    expect(main).toContain('useContentSize: true');
    expect(main).toContain('captureEditorialQa');
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
