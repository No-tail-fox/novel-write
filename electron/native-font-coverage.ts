import type { BrowserWindow } from 'electron';
import type { ProductionSubtitleSceneLayout } from '../src/shared/production-subtitle-layout';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';

/** Resolve the fallback fonts used by Chromium for the font stacks observed on real drawing calls. */
export async function measureNativeGlyphCoverage(window: BrowserWindow, measurement: ProductionSubtitleSceneLayout, workDir: string): Promise<ProductionSubtitleSceneLayout> {
  if (measurement.status !== 'ok' || !measurement.cues.length) return measurement;
  const debuggerApi = window.webContents.debugger;
  const probeId = 'lemo-font-probe';
  let attached = false;
  const entries = measurement.cues.map(cue => ({ font_families: [] as string[], code_points: [...new Set(Array.from(cue.text ?? '').filter(character => !/\s/u.test(character)).map(character => character.codePointAt(0)!))] }));
  try {
    if (!debuggerApi.isAttached()) { debuggerApi.attach('1.3'); attached = true; }
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    // Canvas exposes a CSS stack, not the platform fallback font. Shape the same
    // observed text/stack in this browser, outside the capture area, to resolve it.
    const probes = measurement.cues.flatMap((cue, index) => (cue.renderedFontFamilies ?? []).map(fontFamily => ({ index, text: cue.text ?? '', fontFamily, fontSize: cue.fontSize })));
    await window.webContents.executeJavaScript(`(async () => {
      document.getElementById(${JSON.stringify(probeId)})?.remove();
      const root = document.createElement('div'); root.id = ${JSON.stringify(probeId)};
      Object.assign(root.style, {position:'absolute',left:'-100000px',top:'0',pointerEvents:'none',whiteSpace:'pre'});
      for (const probe of ${JSON.stringify(probes)}) {
        const span = document.createElement('span'); span.dataset.cueIndex = String(probe.index);
        span.textContent = probe.text; span.style.fontFamily = probe.fontFamily; span.style.fontSize = probe.fontSize + 'px'; root.append(span);
      }
      document.body.append(root); await document.fonts.ready;
      root.getBoundingClientRect();
    })()`, true);
    const dom = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1 }) as { root?: { nodeId: number } };
    if (!dom.root) throw new Error('Native font probe root unavailable');
    for (let index = 0; index < entries.length; index++) {
      const nodes = await debuggerApi.sendCommand('DOM.querySelectorAll', { nodeId: dom.root.nodeId, selector: '#' + probeId + ' [data-cue-index="' + index + '"]' }) as { nodeIds?: number[] };
      const families = new Set<string>();
      for (const nodeId of nodes.nodeIds ?? []) {
        const result = await debuggerApi.sendCommand('CSS.getPlatformFontsForNode', { nodeId }) as { fonts?: Array<{ familyName?: string; glyphCount?: number }> };
        for (const font of result.fonts ?? []) if (font.familyName && (font.glyphCount ?? 0) > 0) families.add(font.familyName);
      }
      entries[index].font_families = [...families];
    }
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_glyphs', work_dir: workDir, entries }, { timeoutMs: 30_000 });
    if (probe.glyph_results?.length !== entries.length) throw new Error('Native font result count mismatch');
    return { ...measurement, cues: measurement.cues.map((cue, index) => {
      const result = probe.glyph_results![index], entry = entries[index];
      return { ...cue, glyphCoverage: { verification: 'font-engine' as const,
        status: entry.font_families.length ? result.status : 'unavailable' as const,
        codePointCount: entry.code_points.length, renderedCodePointCount: entry.font_families.length ? result.supported_code_points.length : 0,
        missingCodePoints: entry.font_families.length ? result.missing_code_points.map(code => String.fromCodePoint(code)) : [], fontFamilies: result.font_families } };
    }) };
  } catch {
    return { ...measurement, cues: measurement.cues.map((cue, index) => ({ ...cue, glyphCoverage: { verification: 'font-engine' as const, status: 'unavailable' as const,
      codePointCount: entries[index].code_points.length, renderedCodePointCount: 0, missingCodePoints: [], fontFamilies: [] } })) };
  } finally {
    await window.webContents.executeJavaScript('document.getElementById(' + JSON.stringify(probeId) + ')?.remove()', true).catch(() => {});
    if (attached && debuggerApi.isAttached()) debuggerApi.detach();
  }
}
