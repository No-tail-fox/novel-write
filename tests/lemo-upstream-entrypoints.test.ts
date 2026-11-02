import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');
describe('official v4 project entrypoint contracts', () => {
  for (const channel of ['director:render', 'vox:export-shot', 'director:recheck-subtitles', 'director:recheck-media']) {
    it(`${channel} prepares the current picture before building render scenes`, async () => {
      const source = await read('electron/main.ts');
      const handler = source.split(`trustedHandle('${channel}'`)[1]?.split('trustedHandle(')[0];
      expect(handler).toBeTruthy();
      expect(handler).toContain('await prepareLemoUpstreamPicture(lemoProductionLibrary(), taskWorkDir(task), document');
      expect(handler!.indexOf('await prepareLemoUpstreamPicture')).toBeLessThan(handler!.indexOf('buildDirectorRenderScenes('));
      for (const call of handler!.matchAll(/buildDirectorRenderScenes\([^;]+;/g)) expect(call[0]).toContain('upstreamVideoPath');
    });
  }
  it('maps native projects to program captions and never resolves legacy per-shot code', async () => {
    const page = await read('src/features/editorial-collage/EditorialCollagePage.tsx');
    const mapping = page.slice(page.indexOf('function directorShotFromEditorial('));
    expect(mapping).toContain('document.productionRun?.authoringVersion === 4');
    expect(mapping).not.toContain('document.productionRun?.authoringVersion === 3');
    expect(mapping).toContain('nativeCaptions: !upstream');
    expect(mapping).toContain('animation: upstream ? undefined');
    expect(mapping).toContain('upstreamProject: upstream ?');
    const workspace = await read('src/features/director-desk/DirectorDeskWorkspace.tsx');
    expect(workspace).toContain('catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }');
    expect(workspace).toContain('Lemo 原生整片工程');
    expect(workspace).toContain("mode === 'vox' && !selectedShot.upstreamProject ? <RenderStrategyInspector");
    expect(workspace).toContain('disabledFocusable={upstreamExportBusy} aria-busy={upstreamExportBusy}');
    expect(await read('src/ui/Button.tsx')).toContain('disabledFocusable?: boolean');
  });
});
