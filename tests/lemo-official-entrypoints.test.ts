import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve(file), 'utf8');
const main = source('electron/main.ts');
const start = main.indexOf('async (id, productionSettings) => {');
const production = main.slice(start, main.indexOf('compileCode: compileVoxCode', start));

describe('official native production wiring', () => {
  it('chooses the external worker and passes the actual saved protocol and endpoint', () => {
    expect(start).toBeGreaterThan(0);
    expect(production).not.toContain('assertLemoSdkProviderProtocol(');
    expect(production).toContain('native ? await resolveLemoOfficialRuntimeConfig(');
    expect(production).toContain('electronExecutable: process.execPath');
    expect(production).toContain('nodeExecutable: officialLocation.nodeExecutable');
    expect(production).not.toContain('nodeExecutable: process.execPath');
    expect(production).toContain("protocol: resolveLlmProtocol(config.llm), messagesUrl: llmEndpoint(config.llm)");
    expect(production).toContain("resolveLlmProtocol(config.llm) === 'anthropic' ? 'x-api-key' : 'bearer'");
    expect(production).toContain('createLemoOfficialOperations(');
    expect(production).toContain('...officialOperations');
    for (const retired of ['upstreamStep:', 'recoverUpstreamStep:', 'planFilm:', 'editFilmFile:', 'authorFilmFile:', 'generateFilm:']) expect(production).not.toContain(retired);
  });
  it('probes the official runtime during preflight before reserving paid node capacity', () => {
    const probe = production.indexOf('await officialOperations.preflightOfficial(');
    expect(probe).toBeGreaterThan(production.indexOf('preflight: async'));
    expect(probe).toBeLessThan(production.indexOf('directorHistoryReservations.reserve('));
    expect(production).toContain('LEMO_LOCKED_SHOTS');
  });
  it('propagates production cancellation into both renderer phases and removes listeners on exit', () => {
    expect(production).toContain('renderDirectorProject({ id }, document.productionRun!.id, signal)');
    const begin = main.indexOf('async function renderDirectorProject(');
    const render = main.slice(begin, main.indexOf("trustedHandle('director:recheck-subtitles'", begin));
    expect(render).toContain('signal?: AbortSignal');
    expect(render).toContain("signal?.addEventListener('abort', abortRender, { once: true })");
    expect(render).toContain('if (signal?.aborted) abortRender()');
    expect(render.split("signal?.removeEventListener('abort', abortRender)").length - 1).toBe(2);
    expect(render).toContain('signal: renderController.signal');
    expect(render).toContain('renderController.signal.throwIfAborted()');
  });
  it('uses v4 labels and same-session recovery on the real progress surface', () => {
    const progress = source('src/features/editorial-collage/VoxProductionProgress.tsx');
    const page = source('src/features/editorial-collage/EditorialCollagePage.tsx');
    expect(progress).toContain("run?.authoringVersion === 4 && node.kind === 'film-edit'");
    expect(progress).toContain('创意动画 · 整片创作与审片');
    expect(progress).toContain('不会通过新建会话绕过');
    expect(progress).toContain("officialTarget ? '继续官方步骤'");
    expect(progress).not.toContain("onControl('recheck-code')");
    expect(page).toContain('voxProductionNodeLabel(productionRun, activeNode)');
    expect(page).toContain('document.productionRun?.authoringVersion === 4');
  });
});
