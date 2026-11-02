import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';

// Minimal binary font directories exercise the real Python cmap reader. They
// intentionally contain no outlines and are never presented as rendered fonts.
function format4(point: number) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt16BE(4, 0); bytes.writeUInt16BE(bytes.length, 2); bytes.writeUInt16BE(4, 6);
  bytes.writeUInt16BE(4, 8); bytes.writeUInt16BE(1, 10);
  bytes.writeUInt16BE(point, 14); bytes.writeUInt16BE(0xffff, 16);
  bytes.writeUInt16BE(point, 20); bytes.writeUInt16BE(0xffff, 22);
  bytes.writeUInt16BE((7 - point) & 0xffff, 24); bytes.writeUInt16BE(1, 26);
  return bytes;
}
function format12(points: number[]) {
  const bytes = Buffer.alloc(16 + points.length * 12);
  bytes.writeUInt16BE(12, 0); bytes.writeUInt32BE(bytes.length, 4); bytes.writeUInt32BE(points.length, 12);
  points.forEach((point, index) => {
    bytes.writeUInt32BE(point, 16 + index * 12); bytes.writeUInt32BE(point, 20 + index * 12); bytes.writeUInt32BE(index + 8, 24 + index * 12);
  });
  return bytes;
}
function cmap(subtable: Buffer) {
  const bytes = Buffer.alloc(12 + subtable.length); bytes.writeUInt16BE(1, 2);
  bytes.writeUInt16BE(3, 4); bytes.writeUInt16BE(subtable.readUInt16BE(0) === 12 ? 10 : 1, 6);
  bytes.writeUInt32BE(12, 8); subtable.copy(bytes, 12); return bytes;
}
function directory(bytes: Buffer, base: number, tableOffset: number, table: Buffer) {
  bytes.writeUInt32BE(0x00010000, base); bytes.writeUInt16BE(1, base + 4);
  bytes.write('cmap', base + 12, 'ascii'); bytes.writeUInt32BE(tableOffset, base + 20); bytes.writeUInt32BE(table.length, base + 24);
  table.copy(bytes, tableOffset);
}
function ttf() {
  const bytes = Buffer.alloc(128); directory(bytes, 0, 64, cmap(format4(0x56de))); return bytes;
}
function ttc(shared = false) {
  const bytes = Buffer.alloc(768); bytes.write('ttcf', 0, 'ascii'); bytes.writeUInt32BE(0x00010000, 4);
  bytes.writeUInt32BE(2, 8); bytes.writeUInt32BE(64, 12); bytes.writeUInt32BE(128, 16);
  directory(bytes, 64, 256, cmap(format4(0x56de)));
  directory(bytes, 128, shared ? 256 : 512, cmap(shared ? format4(0x56de) : format12([0x5bb6, 0x20000])));
  return bytes;
}

const pythonProbe = String.raw`
import json, os, runpy, sys, types
namespace = runpy.run_path(sys.argv[1])
probe = namespace['probe_glyphs']
class RegistryKey:
    def __enter__(self): return self
    def __exit__(self, *args): return False
registry = types.SimpleNamespace(HKEY_LOCAL_MACHINE=1, OpenKey=lambda *args: RegistryKey(),
    QueryInfoKey=lambda key: (0, 1, 0), EnumValue=lambda key, index: ('Fixture CJK (TrueType)', sys.argv[2], 1))
sys.modules['winreg'] = registry
# Exercise the Windows parser deterministically on every test host without
# querying or changing that host's registry or loading any real user font.
probe.__globals__['os'] = types.SimpleNamespace(name='nt', path=os.path, environ={})
print(json.dumps(probe({'entries': [{'font_families':['Fixture CJK'], 'code_points':json.loads(sys.argv[3])}]})))
`;

describe('real media sidecar SFNT/TTC Unicode cmap offsets', () => {
  it.each([
    { name: 'standalone TTF', bytes: ttf(), supported: [0x56de], missing: [0x5bb6, 0x20000, 0x2603] },
    { name: 'two nonzero-offset TTC members', bytes: ttc(), supported: [0x56de, 0x5bb6, 0x20000], missing: [0x2603] },
    { name: 'TTC members sharing an absolute cmap offset', bytes: ttc(true), supported: [0x56de], missing: [0x5bb6, 0x20000, 0x2603] },
    { name: 'fully covered CJK TTC text', bytes: ttc(), supported: [0x56de, 0x5bb6, 0x20000], missing: [] },
  ])('resolves $name and retains missing-glyph evidence', async ({ bytes, supported, missing }) => {
    const root = resolve(tmpdir()); const directory = await mkdtemp(join(root, 'storydream-font-cmap-'));
    try {
      const script = await writeStoryboundSidecarScript(directory); const font = join(directory, 'fixture.font'); await writeFile(font, bytes);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command,
        ['-c', pythonProbe, script, font, JSON.stringify([...supported, ...missing])],
        { cwd: directory, timeoutMs: 10000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ success: true, glyph_results: [{ status: missing.length ? 'failed' : 'ok',
        supported_code_points: supported, missing_code_points: missing, font_families: ['Fixture CJK'] }] });
    } finally {
      if (!resolve(directory).startsWith(root + sep)) throw new Error('FIXTURE_PATH');
      await rm(directory, { recursive: true, force: true });
    }
  });
});
