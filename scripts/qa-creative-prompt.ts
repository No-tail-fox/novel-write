/** One bounded real-model check of the tightened prompt. Isolated journal; never retries. */
import { app, BrowserWindow, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileDatabase } from '../src/shared/storage';
import { CredentialVault } from '../electron/credential-vault';
import { ConfigService } from '../electron/config-service';
import { createConfiguredTextLlm } from '../src/shared/llm-provider';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createVoxProductionRuntime } from '../electron/vox-production-runtime';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { voxAnimationMessages } from '../src/shared/vox-animation-prompt';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { reviewCreativeAnimation } from '../electron/creative-animation-preview';
import { CREATIVE_REVIEW_REVISION } from '../src/shared/creative-animation/review';

const root = resolve('.'), work = join(root, '.artifacts/creative-prompt');
const profile = join(root, '.artifacts/creative-integration/profile');
if (process.env.VOX_QA_PAID !== '1') throw new Error('Cost announcement and explicit QA opt-in are required.');
await mkdir(work, { recursive: true });
app.setPath('userData', profile);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const persist = (name: string, value: unknown) => writeFile(join(work, name), JSON.stringify(value, null, 2), 'utf8');
const never = async (): Promise<never> => { throw new Error('Additional paid operations are forbidden.'); };
let database: FileDatabase | undefined;
try {
  // wx persists the request claim before any dispatch. Re-running this script cannot charge again.
  const requestId = randomUUID();
  await writeFile(join(work, 'claim.json'), JSON.stringify({ requestId, maxCalls: 1 }), { encoding: 'utf8', flag: 'wx' });
  const dataDir = join(profile, 'storydream');
  database = await FileDatabase.open(join(dataDir, 'data.db'));
  const service = new ConfigService({ database, dataDir, vault: new CredentialVault(join(dataDir, 'secrets.v1.json'), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(), encryptString: value => safeStorage.encryptString(value), decryptString: value => safeStorage.decryptString(value),
  }) });
  const config = await service.getRuntimeConfig();
  let document = parseEditorialCollagePipelineData(JSON.parse(await readFile(join(root, '.artifacts/creative-integration/document.json'), 'utf8')));
  const shotId = document.beats[0].shots[0].id;
  const reference = await loadCreativeStyleReference(join(root, 'vendor/lemo-opuscar'), 'dataviz');
  let calls = 0;
  const runtime = createVoxProductionRuntime({ identity: 'tightened-prompt-qa', imageModel: '', voiceModel: '',
    voice: { provider: 'volcengine', voiceId: 'unused', voiceLabel: 'unused', speed: 1 }, preflight() {},
    plan: never, image: never, speech: never, cutout: never, render: never, verifyVideo: never, compileCode: compileVoxCode,
    generateCode: async input => {
      if (++calls > 1) throw new Error('Exactly one call is permitted.');
      const messages = voxAnimationMessages(input); messages[0].content += `\n${reference}`;
      const result = await createConfiguredTextLlm(config.llm).run({ step: 1, name: '创意动画紧凑提示验收', messages, maxTokens: 10000, maxRetries: 0, timeoutMs: 180000 });
      await persist('response.json', { requestId, providerRequestId: result.requestId, model: config.llm.model, source: result.text });
      return result.text;
    },
    previewCode: (d, id) => reviewCreativeAnimation(d, id, join(work, 'preview'), join(root, 'dist-electron/electron/vox-animation-runtime.js')),
  });
  const node = (kind: 'code' | 'code-review') => ({ ...document.productionRun!.nodes.find(n => n.kind === kind && n.shotId === shotId)!, requestId });
  document = await runtime.execute(document, node('code'));
  await persist('document.json', document);
  document = await runtime.execute(document, node('code-review'));
  await persist('document.json', document);
  const animation = document.beats[0].shots[0].animation!;
  await persist('report.json', { surface: 'isolated single-shot real prompt trial; no product IPC', calls, model: config.llm.model,
    requestId, reviewRevision: CREATIVE_REVIEW_REVISION, status: animation.authoring!.status, error: animation.authoring!.error,
    aestheticReview: false, sourceLength: animation.code.source.length, previewPaths: animation.authoring!.previewPaths,
    limitations: ['One dataviz shot, 16:9', 'No VLM', 'No paid repair or full-film generation in this trial'] });
  console.log(JSON.stringify({ calls, status: animation.authoring!.status, error: animation.authoring!.error }));
  await database.close(); keep.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); await database?.close(); keep.destroy(); app.exit(1);
}
