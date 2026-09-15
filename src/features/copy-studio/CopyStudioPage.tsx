import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, FileClock, Loader2, Search, Sparkles, Wand2 } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AiSourceContext, AiSourceSection, ShellView, WebSearchProvider } from '../../shared/types';
import { Button, CheckboxField, SegmentedControl, SelectField, TextAreaField, TextField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { copySourceKey, createCopyRevision, handoffCopyToVideo, readCopyStudioDocument, writeCopyStudioDocument, type CopyRevision, type CopyRevisionKind } from './copy-studio';
import './copy-studio.css';

const providers: ReadonlyArray<{ value: WebSearchProvider; label: string }> = [
  { value: 'bing', label: '必应' }, { value: 'baidu', label: '百度' }, { value: 'sogou', label: '搜狗' }, { value: 'toutiao', label: '头条' },
];
const trackOptions = [
  { value: 'character-story', label: '人物故事' }, { value: 'book-product', label: '好书带货' },
  { value: 'knowledge', label: '知识科普' }, { value: 'food-vlog', label: '美食探店' }, { value: 'custom', label: '自定义赛道' },
] as const;

function sourceLabel(source: AiSourceSection): string {
  try { return new URL(source.url || '').hostname.replace(/^www\./u, '') || source.source; } catch { return source.source || '网页'; }
}

function revisionLabel(kind: CopyRevisionKind, count: number): string {
  if (kind === 'draft') return '来源初稿';
  if (kind === 'track') return `赛道强化 ${count}`;
  return `精修 ${count}`;
}

export function CopyStudioPage({ api, navigate }: { api: StoryDreamApi; navigate: (view: ShellView) => void }) {
  const restored = useMemo(() => readCopyStudioDocument(window.localStorage), []);
  const [topic, setTopic] = useState(restored?.topic || '');
  const [requirements, setRequirements] = useState(restored?.requirements || '500 字左右，事实准确，口语化，有清晰开头、推进和收束');
  const [track, setTrack] = useState(restored?.track || 'character-story');
  const [customTrack, setCustomTrack] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<WebSearchProvider[]>(providers.map((item) => item.value));
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(() => restored?.sources.length ? { query: restored.topic, sections: restored.sources, warnings: [] } : null);
  const [sourceIds, setSourceIds] = useState<string[]>(restored?.sourceIds || []);
  const [revisions, setRevisions] = useState<CopyRevision[]>(restored?.revisions || []);
  const [activeRevisionId, setActiveRevisionId] = useState(restored?.activeRevisionId || restored?.revisions.at(-1)?.id || '');
  const [editorText, setEditorText] = useState(() => restored?.revisions.find((item) => item.id === restored.activeRevisionId)?.text || restored?.revisions.at(-1)?.text || '');
  const [refineInstruction, setRefineInstruction] = useState('压缩重复表达，加强前 3 句吸引力，保留全部可核验事实');
  const [skipReview, setSkipReview] = useState(false);
  const [notice, setNotice] = useState('');
  const searchAction = useAsyncAction();
  const composeAction = useAsyncAction();
  const selectedSources = (searchContext?.sections || []).filter((source) => sourceIds.includes(copySourceKey(source)));

  useEffect(() => {
    writeCopyStudioDocument(window.localStorage, { version: 1, topic, requirements, track, sourceIds, sources: searchContext?.sections || [], revisions, activeRevisionId, updatedAt: new Date().toISOString() });
  }, [topic, requirements, track, sourceIds, searchContext, revisions, activeRevisionId]);

  function toggleProvider(provider: WebSearchProvider) {
    setSelectedProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  }

  async function searchSources() {
    if (!topic.trim() || !selectedProviders.length) { setNotice(!topic.trim() ? '请先输入搜索主题。' : '请至少选择一个搜索渠道。'); return; }
    await searchAction.run(async () => {
      setNotice('正在搜索并读取网页正文...');
      const result = await api.searchWebSources({ query: topic.trim(), providers: selectedProviders });
      setSearchContext({ ...result, sections: result.sections.slice(0, 12) });
      setSourceIds([]);
      setNotice(result.sections.length ? `找到 ${Math.min(result.sections.length, 12)} 条来源，请选择用于创作的资料。` : '没有找到可用来源，请调整主题后重试。');
    }, { onError: (error) => setNotice(error.message) });
  }

  function appendRevision(text: string, kind: CopyRevisionKind, instruction: string) {
    const count = revisions.filter((item) => item.kind === kind).length + 1;
    const revision = createCopyRevision({ kind, label: revisionLabel(kind, count), instruction, text });
    setRevisions((current) => [...current, revision]);
    setActiveRevisionId(revision.id);
    setEditorText(revision.text);
  }

  async function compose(kind: CopyRevisionKind) {
    if (kind === 'draft' && !selectedSources.length) { setNotice('请先搜索并选择至少 1 条信息来源。'); return; }
    if (kind !== 'draft' && !editorText.trim()) { setNotice('请先生成或输入一版文案。'); return; }
    const actualTrack = track === 'custom' ? customTrack.trim() : trackOptions.find((item) => item.value === track)?.label || track;
    const instruction = kind === 'draft' ? requirements : kind === 'track'
      ? `在不编造事实的前提下，针对“${actualTrack || '自定义'}”赛道强化特色：受众语言、开场钩子、内容节奏、可信表达与结尾行动。${refineInstruction}`
      : refineInstruction;
    await composeAction.run(async () => {
      setNotice(kind === 'draft' ? '正在根据所选来源起稿...' : kind === 'track' ? '正在进行赛道强化...' : '正在精修当前版本...');
      const revisionSource: AiSourceSection[] = kind === 'draft' ? selectedSources : [{
        source: '当前文案', title: '待修改版本', url: '', content: editorText.trim(),
      }];
      const result = await api.composeResearchCopy({ keyword: topic.trim() || '文案精修', extraRequirements: instruction, selectedSources: revisionSource, useBuiltinKnowledge: false });
      appendRevision(result.copy, kind, instruction);
      setNotice(`${revisionLabel(kind, revisions.filter((item) => item.kind === kind).length + 1)}已完成，旧版本仍可随时恢复。`);
    }, { onError: (error) => setNotice(error.message) });
  }

  function selectRevision(revision: CopyRevision) {
    setActiveRevisionId(revision.id);
    setEditorText(revision.text);
    setNotice(`已切换到${revision.label}。`);
  }

  function saveManualVersion() {
    if (!editorText.trim()) { setNotice('当前文案为空，无法保存版本。'); return; }
    appendRevision(editorText.trim(), 'refine', '手动精修');
    setNotice('已保存手动精修版本。');
  }

  function sendToVideo() {
    if (!editorText.trim()) { setNotice('请先完成文案再回传视频制作。'); return; }
    const handoffTrack = track === 'custom' ? customTrack.trim() || 'custom' : track;
    handoffCopyToVideo(window.localStorage, { title: topic, copy: editorText, topic, requirements, track: handoffTrack, sources: selectedSources, skipReview });
    navigate('new-task');
  }

  return <div className="copy-studio" data-copy-studio>
    <aside className="copy-studio-sources" aria-label="信息来源">
      <div className="copy-studio-heading"><h2>来源搜索</h2><span>先建立事实底稿，再进入文案修改</span></div>
      <TextField label="搜索主题" value={topic} placeholder="人物、事件、产品或选题" onChange={(_, data) => setTopic(data.value)} />
      <div className="copy-studio-provider-list" aria-label="搜索渠道">{providers.map((provider) => <CheckboxField key={provider.value} label={provider.label} checked={selectedProviders.includes(provider.value)} onChange={() => toggleProvider(provider.value)} />)}</div>
      <Button variant="primary" icon={searchAction.busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />} disabled={searchAction.busy} onClick={() => void searchSources()}>{searchAction.busy ? '搜索中' : '搜索来源'}</Button>
      <div className="copy-studio-source-list">{searchContext?.sections.map((source) => { const key = copySourceKey(source); return <label key={key} className="copy-studio-source" data-selected={sourceIds.includes(key)}>
        <CheckboxField checked={sourceIds.includes(key)} onChange={() => setSourceIds((current) => current.includes(key) ? current.filter((id) => id !== key) : [...current, key])} />
        <span><strong>{source.title}</strong><small>{sourceLabel(source)}</small><em>{source.content}</em></span>
      </label>; })}</div>
    </aside>

    <main className="copy-studio-editor" aria-label="文案编辑器">
      <div className="copy-studio-editor-toolbar"><div><h2>文案精修</h2><span>{editorText.trim().length} 字 · {revisions.length} 个版本</span></div><Button density="compact" icon={<FileClock size={15} />} disabled={!editorText.trim()} onClick={saveManualVersion}>保存当前版本</Button></div>
      <TextAreaField label="创作要求" rows={3} value={requirements} onChange={(_, data) => setRequirements(data.value)} />
      <Button variant="primary" icon={composeAction.busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} disabled={composeAction.busy || !selectedSources.length} onClick={() => void compose('draft')}>根据 {selectedSources.length} 条来源生成初稿</Button>
      <TextAreaField className="copy-studio-copy-field" label="当前文案" rows={18} value={editorText} placeholder="选择来源生成初稿，也可以直接在这里粘贴文案" onChange={(_, data) => setEditorText(data.value)} />
      <TextAreaField label="本轮修改要求" rows={3} value={refineInstruction} onChange={(_, data) => setRefineInstruction(data.value)} />
      <div className="copy-studio-edit-actions"><Button icon={<Wand2 size={15} />} disabled={composeAction.busy || !editorText.trim() || !refineInstruction.trim()} onClick={() => void compose('refine')}>按要求精修一轮</Button><Button icon={<Sparkles size={15} />} disabled={composeAction.busy || !editorText.trim()} onClick={() => void compose('track')}>增加赛道特色</Button></div>
      {notice ? <p className="copy-studio-notice" role="status">{notice}</p> : null}
    </main>

    <aside className="copy-studio-inspector" aria-label="版本与交接">
      <section><div className="copy-studio-heading"><h2>版本记录</h2><span>每轮生成独立留存</span></div><div className="copy-studio-revisions">{revisions.map((revision, index) => <Button key={revision.id} className="copy-studio-revision" variant="subtle" aria-pressed={revision.id === activeRevisionId} onClick={() => selectRevision(revision)}><span><strong>V{index + 1} · {revision.label}</strong><small>{new Date(revision.createdAt).toLocaleString('zh-CN')}</small><em>{revision.instruction}</em></span></Button>)}</div></section>
      <section className="copy-studio-track"><div className="copy-studio-heading"><h2>特色赛道</h2><span>在最后几轮强化受众与表达</span></div><SelectField label="内容赛道" value={track} options={trackOptions} onChange={(_, data) => setTrack(data.value)} />{track === 'custom' ? <TextField label="自定义赛道" value={customTrack} onChange={(_, data) => setCustomTrack(data.value)} /> : null}</section>
      <section className="copy-studio-handoff"><div className="copy-studio-heading"><h2>送入视频制作</h2><span>回传到原有视频任务创建位置</span></div><SegmentedControl label="预审方式" value={skipReview ? 'skip' : 'review'} options={[{ value: 'review', label: '保留预审' }, { value: 'skip', label: '跳过预审' }]} onChange={(value) => setSkipReview(value === 'skip')} /><p>{skipReview ? '定稿将直接作为正式文案进入分镜与后续制作。' : '定稿会先进入现有预审与改写流程。'}</p><Button variant="primary" icon={<ArrowRight size={16} />} iconPosition="after" disabled={!editorText.trim()} onClick={sendToVideo}>回传并继续视频制作</Button>{editorText.trim() ? <span className="copy-studio-ready"><Check size={14} />当前版本可交接</span> : null}</section>
    </aside>
  </div>;
}
