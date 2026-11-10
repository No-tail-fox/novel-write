import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// P-6: every third-party runtime that the build copies into dist-electron is attributed.
describe('third-party attribution coverage', () => {
  const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  const build = readFileSync('scripts/build-electron.mjs', 'utf8');

  it.each([
    ['@hyperframes/core', 'HyperFrames', 'Apache License 2.0'],
    ['gsap', 'GSAP', 'standard-license'],
    ['three', 'Three.js', 'MIT'],
    ['vendor/lemo-upstream', 'Lemo-Opuscar full-source library', 'CC BY 4.0'],
    ['vendor/pixelle-upstream', 'Pixelle-Video', 'Apache-2.0'],
  ])('build copies %s and the notices name %s with its license', (copied, section, license) => {
    if (copied.startsWith('vendor/')) expect(notices).toContain(copied);
    else expect(build).toContain(`node_modules/${copied}/`);
    const start = notices.indexOf(`## ${section}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = notices.indexOf('\n## ', start + 3);
    expect(notices.slice(start, next < 0 ? undefined : next)).toContain(license);
  });

  it('ships the HyperFrames license text next to its runtime', () => {
    expect(build).toContain("'node_modules/@hyperframes/core/LICENSE', 'dist-electron/electron/HYPERFRAMES_LICENSE.txt'");
  });
});
