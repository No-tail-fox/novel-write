import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E-7 (offline part): GSAP's licence is pending legal review. Until then GSAP stays confined to the
 * host-owned HTML-route template and the HyperFrames runtime it drives; no model prompt asks for it and
 * the new-architecture scene runtime does not depend on it. A new GSAP reference must be a deliberate,
 * reviewed change to this allowlist.
 */
const GSAP_ALLOWED = new Set([
  'electron/html-video-frame-seek.ts', // seeks the host template's timeline
  'electron/html-video-runtime.ts', // copies gsap.min.js next to the host template
  'electron/main.ts', // passes the bundled runtime path to the HTML route
  'src/shared/html-video.ts', // host-generated HTML template (not model-authored code)
  'src/shared/html-video-authoring.ts', // tells the model the HOST builds the GSAP timeline; the model outputs a plan only
  'src/shared/hyperframes.ts', // runtime file names
  'src/shared/scene-runtime.ts', // comment: why the HF adapter does not await GSAP thenables
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:ts|tsx|mjs|cjs|html)$/u.test(entry.name) ? [path.replace(/\\/gu, '/')] : [];
  });
}

describe('GSAP licence containment (E-7)', () => {
  const files = [...sources('src'), ...sources('electron')];

  it('only allowlisted host files reference GSAP', () => {
    const offenders = files.filter(path => !GSAP_ALLOWED.has(path) && /gsap/iu.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('model-facing authoring text never asks the model to write GSAP code', () => {
    const authoring = readFileSync('src/shared/html-video-authoring.ts', 'utf8');
    const lines = authoring.split(/\r?\n/u).filter(line => /gsap/iu.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/只输出场景计划|由宿主生成/u);
  });

  it('the new-architecture adapters run without GSAP', () => {
    const runtime = readFileSync('src/shared/scene-runtime.ts', 'utf8');
    expect(runtime).not.toMatch(/window\.gsap|gsap\.(?:timeline|to|from|set)\(/u);
  });

  it('declares GSAP and its pending review in the third-party notices', () => {
    const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
    expect(notices).toContain('## GSAP');
    expect(notices).toContain('pending legal review (backlog E-7)');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.gsap).toBe('3.12.5');
  });
});
