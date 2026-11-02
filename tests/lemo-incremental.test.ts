import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { applyLemoEdits } from '../src/shared/creative-animation/lemo-edits';
import { lemoProjectFiles, lemoProjectSchema } from '../src/shared/creative-animation/native-project';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { buildVoxProductionNodes, type VoxProductionNode } from '../src/shared/vox-production';
import { voxInputHash } from '../electron/vox-production-service';
import { lemoEditReference, loadCreativeStyleReference } from '../electron/creative-style-references';
describe('bounded exact-source edit transactions', () => {
  const source = 'const palette={ink:1}; return {palette};';
  const hash = createHash('sha256').update(source).digest('hex');
  const patch = (edits: {search:string;replace:string}[], baseHash = hash) => JSON.stringify({ baseHash, edits, done: true, summary: '调整色板' });
  it('extracts one complete fenced JSON reply without changing embedded code strings', () => {
    const json = patch([{ search: 'ink:1', replace: 'ink:2' }]);
    const fenced = 'Batch explanation.\n\n```json\n' + json + '\n```\nCompleted this batch.';
    expect(applyLemoEdits(source, hash, fenced).source).toBe('const palette={ink:2}; return {palette};');
    expect(() => applyLemoEdits(source, hash, fenced + '\n```json\n' + json + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json)).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n```json\n' + json.slice(0, -2) + '\n```')).toThrow('LEMO_EDIT_INVALID');
    expect(() => applyLemoEdits(source, hash, 'Batch\n' + json)).toThrow('LEMO_EDIT_INVALID');
  });
  it('applies ordered unique edits and checks the saved base hash', () => {
    expect(applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }])).source).toContain('ink:2');
    expect(() => applyLemoEdits(source, hash, patch([{ search: 'ink:1', replace: 'ink:2' }], '0'.repeat(64)))).toThrow('LEMO_EDIT_STALE');
  });
  it.each([
    [{ search: 'palette', replace: 'p' }], [{ search: 'missing', replace: 'p' }], [{ search: '', replace: 'p' }], [{ search: 'ink:1', replace: 'ink:1' }],
  ])('rejects missing, ambiguous, empty and no-op searches %#', (...edits) => {
    expect(() => applyLemoEdits(source, hash, patch(edits))).toThrow('LEMO_EDIT_');
  });
  it('reports an oversized replacement as a size failure with the actual limit, rather than malformed JSON', () => {
    const atLimit = '/*' + 'x'.repeat(15986) + '*/return {};';
    expect(atLimit).toHaveLength(16000);
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: atLimit }])).source).toBe(atLimit);
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16001 字符');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: atLimit + ' ' }]))).toThrow('16000 字符限制');
  });
  it('limits reply size and permits an empty insertion only for a new file', () => {
    expect(applyLemoEdits('', hash, patch([{ search: '', replace: 'return {};' }])).source).toBe('return {};');
    expect(() => applyLemoEdits(source, hash, patch([{ search: source, replace: 'x'.repeat(16001) }]))).toThrow('LEMO_EDIT_SIZE');
    expect(() => applyLemoEdits(source, hash, '{')).toThrow('LEMO_EDIT_INVALID');
  });
});

describe('retained incremental parser and reference utilities', () => {
  it('preserves long raw replies, summaries and interrupted attempts through project serialization', () => {
    const summary = '  保留完整创作说明'.repeat(10000) + '  ';
    const rawResponse = JSON.stringify({ baseHash: 'a'.repeat(64), edits: [], done: true, summary });
    expect(rawResponse.length).toBeGreaterThan(90000);
    const files = lemoProjectFiles(['shot-1']);
    files[0] = { ...files[0], source: 'return {palette:1};', status: 'valid', attempts: [{ requestId: 'retained-request', providerRequestId: 'retained-provider-id', source: 'return {palette:1};', rawResponse, summary, applied: false, interrupted: true }] };
    const parsed = lemoProjectSchema.parse(JSON.parse(JSON.stringify({ version: 2, authoringMode: 'incremental', materials: [], bindings: {}, files, repairFileIds: [], samplePaths: [] })));
    expect(parsed.files[0].attempts[0]).toMatchObject({ rawResponse, summary, applied: false, interrupted: true, providerRequestId: 'retained-provider-id' });
    expect(parsed.files[0].source).toBe(files[0].source);
  });
  it('retains complete style and technique guidance without duplicating director guidance', async () => {
    const full = await loadCreativeStyleReference(join(process.cwd(), 'vendor/lemo-opuscar'), 'watercolor', 'lemo-native-v1');
    const focused = lemoEditReference(full);
    expect(focused).toContain(full.match(/<style-reference[\s\S]*?<\/style-reference>/)![0]);
    expect(focused).toContain('<technique-reference>'); expect(focused).not.toContain('<director-reference>');
  });
});

describe('official v4 rejects retired incremental entry points', () => {
  function current() {
    const d = nativeDocument(), settings = nativeSettings();
    d.productionRun = { version: 1, id: 'official-only', status: 'paused', engine: LEMO_NATIVE_ENGINE, authoringVersion: 4,
      settings, nodes: buildVoxProductionNodes(d, settings, LEMO_NATIVE_ENGINE, 4),
      sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'native-offline-test', createdAt: d.createdAt, updatedAt: d.updatedAt };
    return d;
  }
  it.each(['film-code:shared:edit:2', 'film-sample-repair:shared:edit:1', 'film-repair:scene-1:edit:1'])('rejects legacy batch %s without a paid fallback', async id => {
    const d = current(), editFilmFile = vi.fn(), authorFilmFile = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn();
    const h = nativeHarness({ editFilmFile, authorFilmFile, officialStep, recoverOfficialStep }, d);
    const node: VoxProductionNode = { id, kind: 'film-edit', fileId: 'shared', editSession: 'film-code:shared', editRound: 2, dependencies: [], status: 'unknown', paid: true, attempt: 1, requestId: 'retained-request' };
    await expect(h.runtime.execute(d, node)).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    await expect(h.runtime.recover!(d, node)).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    for (const operation of [editFilmFile, authorFilmFile, officialStep, recoverOfficialStep]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(d); expect(h.receipts.size).toBe(0);
  });
  it('rejects the removed recheck-code action without invalidating official artifacts or saving a new run', async () => {
    const d = current(), editFilmFile = vi.fn(), previewCode = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn();
    const h = nativeHarness({ editFilmFile, previewCode, officialStep, recoverOfficialStep }, d), save = vi.spyOn(h.store, 'save');
    await expect(h.service.control({ id: d.id, runId: d.productionRun!.id, action: 'recheck-code' })).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    for (const operation of [editFilmFile, previewCode, officialStep, recoverOfficialStep, save]) expect(operation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(d); expect(h.calls).toEqual([]);
  });
});
