// Offline synthetic fixture: the real reference board + removal guard, no IPC or provider calls.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider, Button, Toolbar } from '../src/ui';
import { MotionComicReferenceBoard, type MotionComicReferenceCard } from '../src/features/motion-comic/MotionComicReferenceBoard';
import type { MotionComicReferenceJob } from '../src/features/motion-comic/MotionComicReferenceEditor';
import { MotionComicAssetUsage } from '../src/features/motion-comic/MotionComicAssetUsage';
import { MotionComicAssetRemoveDialog } from '../src/features/motion-comic/MotionComicAssetRemoveDialog';
import { fixedMotionComicReferenceAsset, fixedMotionComicReferenceAssets, motionComicReferenceAssets, motionComicReferenceRole, setMotionComicReferenceRole, unpinMotionComicReference } from '../src/features/motion-comic/motion-comic-consistency';
import { createMotionComicDraft, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles/tokens.css';
import '../src/features/motion-comic/MotionComicReferenceEditor.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/motion-comic.css';
import '../src/features/motion-comic/MotionComicAssetRemoveDialog.css';

const log: string[] = [];
Object.assign(window, { removalLog: () => log.join('|') });

function fixture(): MotionComicPipelineData {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'offline-detail', title: '离线资产详情', premise: '测试', now: '2026-09-05T00:00:00.000Z' }), '第一集');
  document.characters = [{
    id: 'nezha', name: '哪吒', role: '少年神将', identityPrompt: '莲花重塑之身，东海战后归来。', personality: '', voiceNotes: '',
    looks: [
      { id: 'look-0', characterId: 'nezha', label: '东海战后红绫装', appearancePrompt: '十六七岁莲花重塑少年神将，白皙面容，朱唇，黑色高束发，眉心鲜红竖印。', wardrobe: '混天绫缠绕精瘦腰腹，赤红战斗装束，脚下风火轮。', continuityNotes: '东海战场固定使用；眉心血印与混天绫不可改变。', referenceAssetVersionIds: [], pinned: true },
      { id: 'look-1', characterId: 'nezha', label: '混天绫战损', appearancePrompt: '战损造型：衣甲破损，面部带灰。', wardrobe: '破损红绫，暗色内衬。', continuityNotes: '', referenceAssetVersionIds: ['candidate-1'], pinned: false },
    ],
  }];
  document.sceneAssets = [{ id: 'sea', label: '东海龙宫', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] }];
  document.series.characterIds = ['nezha'];
  document.series.sceneAssetIds = ['sea'];
  document.assets = [{ id: 'candidate-1', assetId: 'look-1', kind: 'image', localPath: 'missing.png', createdAt: '2026-09-05T10:00:00.000Z' }] as MotionComicPipelineData['assets'];
  const shot = document.episodes[0].scenes[0].shots[0];
  shot.characterLookIds = ['look-0'];
  shot.sceneAssetId = 'sea';
  // Synthetic offline bitmap so the fixed/preview states render without touching disk paths.
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 480, 360);
  gradient.addColorStop(0, '#2a1b4b');
  gradient.addColorStop(1, '#c2333a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 480, 360);
  context.fillStyle = 'rgba(255,255,255,.85)';
  context.font = '600 28px sans-serif';
  context.fillText('OFFLINE FIXTURE', 40, 300);
  const dataUrl = canvas.toDataURL('image/png');
  document.assets = [
    { id: 'fixed-0', assetId: 'look-0', kind: 'image', localPath: dataUrl, pinned: true, selected: true, referenceRole: 'design', createdAt: '2026-09-05T09:00:00.000Z' },
    { id: 'fixed-front', assetId: 'look-0', kind: 'image', localPath: dataUrl, pinned: true, selected: true, referenceRole: 'front', createdAt: '2026-09-05T09:10:00.000Z' },
    { id: 'candidate-1', assetId: 'look-1', kind: 'image', localPath: dataUrl, createdAt: '2026-09-05T10:00:00.000Z' },
    { id: 'candidate-2', assetId: 'look-0', kind: 'image', localPath: dataUrl, createdAt: '2026-09-05T10:10:00.000Z' },
    { id: 'candidate-3', assetId: 'look-0', kind: 'image', localPath: dataUrl, createdAt: '2026-09-05T10:20:00.000Z' },
    { id: 'candidate-4', assetId: 'look-0', kind: 'image', localPath: dataUrl, createdAt: '2026-09-05T10:30:00.000Z' },
  ] as unknown as MotionComicPipelineData['assets'];
  document.characters[0].looks[0].referenceAssetVersionIds = ['fixed-0', 'fixed-front', 'candidate-2', 'candidate-3', 'candidate-4'];
  return document;
}

const api = { getMotionComicScripts: async () => ({ projectId: 'offline-detail', tasks: [], approvals: [], assetExtractions: [] }) } as unknown as StoryDreamApi;
const job: MotionComicReferenceJob = { label: '正在生成 · 哪吒 · 东海战后红绫装', detail: '批次进度 1/3，预计按顺序返回；可继续编辑其他资产。', progress: 0.34 };

function Fixture() {
  const [document, setDocument] = useState(fixture);
  const [activeLookId, setActiveLookId] = useState('look-0');
  const [showJob, setShowJob] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removalAllowed, setRemovalAllowed] = useState(false);
  const [summary, setSummary] = useState(false);
  const [pending, setPending] = useState<MotionComicReferenceCard[]>([]);
  const [importing, setImporting] = useState(0);
  const [compose, setCompose] = useState(true);
  // Simulates the real picker: imported files wait as cards until a role is chosen.
  const queueImports = () => {
    setImporting(2);
    window.setTimeout(() => {
      setImporting(0);
      setPending((items) => (items.length ? items : [
        { sha256: 'sha-side', versionId: 'candidate-2', paths: [String((fixture().assets.find((asset) => asset.id === 'candidate-2') as { localPath?: string } | undefined)?.localPath)], size: 0 },
        { sha256: 'sha-back', versionId: 'candidate-3', paths: [], size: 0 },
      ]));
    }, 400);
  };
  const character = document.characters[0];
  const look = character.looks.find((item) => item.id === activeLookId) ?? character.looks[0];
  const versions = motionComicReferenceAssets(document, look.referenceAssetVersionIds);
  const fixed = fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds);
  const blocked = character.looks.length < 2 ? '人物至少保留一个造型，请先新增其他造型再删除。'
    : look.id === 'look-0' ? '1 个镜头仍在使用该造型，请先在分镜中改绑或清空后再删除。' : undefined;
  return <StoryDreamProvider theme="dark">
    <div className="motion-comic-page" data-motion-comic-workbench="true">
      <div data-motion-comic-series-bible="true">
        <main className="director-series-editor">
          <section>
            <div className="director-series-section-heading comic-asset-detail-heading">
              <div><h2>{character.name}</h2><small>人物 · 跨集共用 · {character.looks.length} 个造型</small></div>
              <Button density="compact" variant="secondary" onClick={() => setShowJob((value) => !value)}>{showJob ? '模拟后台生成结束' : '模拟后台生成中'}</Button>
            </div>
            {summary ? <div className="comic-asset-summary"><div className="comic-asset-summary__table" role="table" aria-label="造型概览">
              {character.looks.map((item) => <div role="row" className="comic-asset-summary__row" key={item.id}>
                <span role="cell" className="comic-asset-summary__name"><span><strong>{item.label}</strong><small>{item.referenceAssetVersionIds.length} 个版本</small></span></span>
                <span role="cell"><span className={fixedMotionComicReferenceAsset(document, item.referenceAssetVersionIds) ? 'comic-reference-chip is-fixed' : 'comic-reference-chip is-missing'}>{fixedMotionComicReferenceAsset(document, item.referenceAssetVersionIds) ? '已固定' : '待生成'}</span></span>
                <span role="cell" className="comic-asset-summary__actions"><Button density="compact" variant="subtle" onClick={() => { setSummary(false); setActiveLookId(item.id); }}>编辑</Button></span>
              </div>)}
            </div></div> : <>
            <div className="comic-look-tabs" role="tablist" aria-label="角色造型">
              {character.looks.map((item) => <Button key={item.id} variant="subtle" className="comic-look-tab" role="tab"
                aria-selected={item.id === activeLookId} aria-pressed={item.id === activeLookId}
                onClick={() => setActiveLookId(item.id)}>
                <span className="comic-look-tab__thumb" />
                <span><strong>{item.label}</strong><small>{fixedMotionComicReferenceAsset(document, item.referenceAssetVersionIds) ? '已固定' : item.referenceAssetVersionIds.length ? '1 个候选待采用' : '缺少参考图'}</small></span>
              </Button>)}
              <Button variant="subtle" className="comic-look-tab is-add" onClick={() => log.push('add')}><span className="comic-look-tab__thumb" aria-hidden="true" /><span><strong>新增造型</strong><small>沿用同一人物身份</small></span></Button>
            </div>
            <div className="comic-look-panel comic-asset-detail-layout" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1fr)' }}>
              <div className="comic-look-panel__stage">
                <MotionComicReferenceBoard label={`${character.name} · ${look.label}`} versions={versions}
                  slots={fixedMotionComicReferenceAssets(document, look.referenceAssetVersionIds).map((asset) => ({ role: motionComicReferenceRole(asset), versionId: asset.id }))}
                  pending={pending} importing={importing} busy={false} active job={showJob ? job : null} feedback={null}
                  maxImages={6} composeMultiple={compose}
                  onImport={queueImports}
                  onComposeChange={setCompose}
                  onSetRole={(versionId, role) => { setPending((items) => items.filter((card) => card.versionId !== versionId)); setDocument((current) => setMotionComicReferenceRole(current, { kind: 'look', id: look.id }, versionId, role)); }}
                  onUnpin={(versionId) => setDocument((current) => unpinMotionComicReference(current, { kind: 'look', id: look.id }, versionId))}
                  onRemove={(versionId) => setDocument((current) => ({ ...current, characters: current.characters.map((item) => ({ ...item, looks: item.looks.map((candidate) => (candidate.id === look.id ? { ...candidate, referenceAssetVersionIds: candidate.referenceAssetVersionIds.filter((id) => id !== versionId) } : candidate)) })) }))}
                  onDiscard={(versionId) => { setPending((items) => items.filter((card) => card.versionId !== versionId)); setDocument((current) => ({ ...current, characters: current.characters.map((item) => ({ ...item, looks: item.looks.map((candidate) => (candidate.id === look.id ? { ...candidate, referenceAssetVersionIds: candidate.referenceAssetVersionIds.filter((id) => id !== versionId) } : candidate)) })) })); }}
                  onImageStatus={() => undefined} />
                <div className="comic-look-panel__commands">
                  <Button density="compact" variant="primary">生成参考图</Button>
                  <Button density="compact" variant="secondary">导入</Button>
                  <Button density="compact" variant="subtle">素材库</Button>
                </div>
              </div>
              <div className="comic-asset-definition">
                <label className="sd-field-label" htmlFor="name">造型名称</label>
                <input id="name" name="name" key={look.id} defaultValue={look.label} />
                <label className="sd-field-label" htmlFor="appearance">外观特征</label>
                <textarea id="appearance" key={look.id + '-a'} defaultValue={look.appearancePrompt} rows={3} />
                <label className="sd-field-label" htmlFor="wardrobe">服装与配饰</label>
                <textarea id="wardrobe" key={look.id + '-w'} defaultValue={look.wardrobe} rows={3} />
                <label className="sd-field-label" htmlFor="notes">造型连续性要求</label>
                <textarea id="notes" key={look.id + '-n'} defaultValue={look.continuityNotes} rows={2} />
                <div className="comic-asset-definition__footer">
                  <small className="comic-asset-definition__note">删除造型只影响当前项目；仍被镜头引用时会被阻止。</small>
                  <Button variant="danger" density="compact" onClick={() => setRemoveOpen(true)}>删除此造型</Button>
                </div>
              </div>
            </div>
            </>}
            <MotionComicAssetUsage api={api} document={document} target={{ kind: 'character', id: 'nezha' }} busy={false} onOpen={() => undefined} />
            <Button density="compact" variant="subtle" onClick={() => setRemovalAllowed(true)}>允许删除</Button>
            <Button density="compact" variant="secondary" onClick={() => setSummary(true)}>造型总览</Button>
            <span id="removal-log">{log.join(',')}</span>
          </section>
        </main>
      </div>
    </div>
    <MotionComicAssetRemoveDialog open={removeOpen} label="造型" name={`${character.name} · ${look.label}`}
      impact="删除后该造型不再出现在分镜绑定与参考图生成中。"
      notes={['参考图版本记录与图片历史保留，草稿阶段可撤销。']}
      blockedReason={removalAllowed ? undefined : blocked}
      onOpenChange={setRemoveOpen}
      onConfirm={() => {
        log.push(look.id);
        setDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === 'nezha' ? { ...item, looks: item.looks.filter((candidate) => candidate.id !== look.id) } : item) }));
        setActiveLookId('look-0');
        setRemoveOpen(false);
      }} />
  </StoryDreamProvider>;
}

document.body.style.margin = '0';
document.body.style.background = 'var(--shell-bg)';
createRoot(document.getElementById('root')!).render(<Fixture />);
