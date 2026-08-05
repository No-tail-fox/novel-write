import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mic2, RefreshCw, Search } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { activeTtsProfileId, ttsProfileVolcengine } from '../../shared/provider-profile-utils';
import {
  defaultTaskSpeakerForProvider,
  filterTtsVoiceOptions,
  mergeTtsVoiceOptions,
  normalizeRuntimeTtsProvider,
  ttsVoiceOptionsForProvider,
  volcengineSpeakersToVoiceOptions,
  type RuntimeTtsProvider,
  type TtsVoiceOption,
} from '../../shared/tts-voices';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate, toLocalAssetUrl } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

const VOLCENGINE_VOICE_RESOURCES = ['seed-tts-2.0', 'seed-tts-1.0'] as const;
const VOLCENGINE_VOICE_PAGE_LIMIT = 100;
const VOLCENGINE_VOICE_MAX_PAGES = 20;
const volcengineVoiceCatalogCache = new Map<string, Promise<TtsVoiceOption[]>>();
type VolcengineCatalogSecretId = `tts/${string}/volcengine/${'accessKeyId' | 'secretAccessKey'}`;

function volcengineSecretId(profileId: string, name: 'accessKeyId' | 'secretAccessKey'): VolcengineCatalogSecretId {
  return `tts/${encodeURIComponent(profileId)}/volcengine/${name}`;
}

async function fetchVolcengineVoiceCatalog(api: StoryDreamApi, profileId: string): Promise<TtsVoiceOption[]> {
  const accessKeyIdSecretId = volcengineSecretId(profileId, 'accessKeyId');
  const secretAccessKeySecretId = volcengineSecretId(profileId, 'secretAccessKey');
  let options: TtsVoiceOption[] = [];
  for (const resourceId of VOLCENGINE_VOICE_RESOURCES) {
    for (let page = 1; page <= VOLCENGINE_VOICE_MAX_PAGES; page += 1) {
      const result = await api.listVolcengineSpeakers({
        accessKeyId: '',
        secretAccessKey: '',
        accessKeyIdSecretId,
        secretAccessKeySecretId,
        resourceId,
        page,
        limit: VOLCENGINE_VOICE_PAGE_LIMIT,
      });
      if (result.status === 'fail') throw new Error(result.detail);
      options = mergeTtsVoiceOptions(options, volcengineSpeakersToVoiceOptions(result.speakers));
      const loadedThroughPage = page * VOLCENGINE_VOICE_PAGE_LIMIT;
      if (!result.speakers.length || loadedThroughPage >= result.total) break;
    }
  }
  return options;
}

export function VoiceLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [text, setText] = useState('配音实验室试听文案：用稳定、清晰、有情绪的声音讲完这一段故事。');
  const [voiceProvider, setVoiceProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [volcengineVoiceOptions, setVolcengineVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const voiceLabAction = useAsyncAction();
  const currentTtsProfileId = activeTtsProfileId(state.config);
  const currentTtsProfile = state.config.ttsProfiles.find((profile) => profile.id === currentTtsProfileId);
  const currentVolcengineConfig = currentTtsProfile ? ttsProfileVolcengine(currentTtsProfile) : state.config.tts.volcengine;
  const accessKeyIdSecretId = volcengineSecretId(currentTtsProfileId, 'accessKeyId');
  const secretAccessKeySecretId = volcengineSecretId(currentTtsProfileId, 'secretAccessKey');
  const canLoadVolcengineCatalog = state.secretStatus[accessKeyIdSecretId] === true && state.secretStatus[secretAccessKeySecretId] === true;
  const volcengineCatalogKey = `${currentTtsProfileId}:${VOLCENGINE_VOICE_RESOURCES.join(',')}`;
  const voiceOptions = useMemo(
    () => voiceProvider === 'volcengine'
      ? mergeTtsVoiceOptions(volcengineVoiceOptions, ttsVoiceOptionsForProvider('volcengine'))
      : ttsVoiceOptionsForProvider('minimax', state.minimaxCloneVoices),
    [state.minimaxCloneVoices, voiceProvider, volcengineVoiceOptions],
  );
  const visibleVoiceOptions = useMemo(() => filterTtsVoiceOptions(voiceOptions, voiceQuery), [voiceOptions, voiceQuery]);
  const selectedVoiceLabel = voiceOptions.find((option) => option.id === voiceId)?.label ?? voiceId;

  useEffect(() => {
    if (voiceProvider !== 'volcengine') return;
    if (!canLoadVolcengineCatalog) {
      setCatalogLoading(false);
      setVolcengineVoiceOptions([]);
      setCatalogError('当前 TTS 配置档案未配置豆包音色列表 AK/SK，请先在设置中填写。');
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError('');
    let request = volcengineVoiceCatalogCache.get(volcengineCatalogKey);
    if (!request) {
      request = fetchVolcengineVoiceCatalog(api, currentTtsProfileId);
      volcengineVoiceCatalogCache.set(volcengineCatalogKey, request);
    }
    void request.then((options) => {
      if (!cancelled) setVolcengineVoiceOptions(options);
    }).catch((error: unknown) => {
      volcengineVoiceCatalogCache.delete(volcengineCatalogKey);
      if (!cancelled) setCatalogError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setCatalogLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, canLoadVolcengineCatalog, catalogReload, currentTtsProfileId, voiceProvider, volcengineCatalogKey]);

  useEffect(() => {
    if (voiceOptions.some((option) => option.id === voiceId) || (voiceProvider === 'volcengine' && catalogLoading)) return;
    const preferred = defaultTaskSpeakerForProvider(voiceProvider, state.config);
    setVoiceId(voiceOptions.some((option) => option.id === preferred) ? preferred : voiceOptions[0]?.id ?? '');
  }, [catalogLoading, state.config, voiceId, voiceOptions, voiceProvider]);

  function changeProvider(provider: string) {
    const nextProvider = normalizeRuntimeTtsProvider(provider);
    setVoiceProvider(nextProvider);
    setVoiceId(defaultTaskSpeakerForProvider(nextProvider, state.config));
    setVoiceQuery('');
  }

  function reloadVolcengineCatalog() {
    volcengineVoiceCatalogCache.delete(volcengineCatalogKey);
    setCatalogReload((value) => value + 1);
  }

  async function generatePreview() {
    if (generating || !text.trim() || !voiceId) return;
    await voiceLabAction.run(async () => {
      setGenerating(true);
      setSubmitError('');
      try {
        const next = await api.generateVoiceLabPreview({
          text,
          provider: voiceProvider,
          voiceId,
          voiceLabel: selectedVoiceLabel,
          speed: voiceSpeed,
        });
        applyState(next);
      } finally {
        setGenerating(false);
      }
    }, { onError: (error) => setSubmitError(error.message) });
  }

  return (
    <div className="local-lab-workbench voice-lab-layout lab-layout" data-local-lab-workbench="voice-lab">
      <section className="local-lab-rail voice-lab-controls">
        <Field label="试听文案">
          <textarea className="prompt-box voice-lab-text" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <Segmented label="配音模型" value={voiceProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={changeProvider} />
        <div className="voice-lab-voices">
          <div className="voice-lab-voice-header">
            <span className="field-title">音色</span>
            <span className="hint-text">{visibleVoiceOptions.length}/{voiceOptions.length}</span>
            {voiceProvider === 'volcengine' ? (
              <button className="icon-button" type="button" title="重新加载豆包音色" aria-label="重新加载豆包音色" disabled={catalogLoading || !canLoadVolcengineCatalog} onClick={reloadVolcengineCatalog}>
                <RefreshCw className={catalogLoading ? 'spin' : undefined} size={14} />
              </button>
            ) : null}
          </div>
          <label className="voice-lab-voice-search">
            <Search size={14} />
            <input aria-label="搜索音色" value={voiceQuery} placeholder="搜索名称或 voice ID" onChange={(event) => setVoiceQuery(event.target.value)} />
          </label>
          {voiceProvider === 'volcengine' && catalogError ? <div className="voice-lab-catalog-status" role="status">{catalogError}</div> : null}
          <div className="chip-row voice-lab-voice-list" aria-label={`${voiceProvider === 'volcengine' ? '豆包' : 'MiniMax'} 音色列表`}>
            {visibleVoiceOptions.map((voice) => (
              <button type="button" key={voice.id} className={voiceId === voice.id ? 'chip active' : 'chip'} title={voice.id} aria-pressed={voiceId === voice.id} onClick={() => setVoiceId(voice.id)}>
                <strong>{voice.label}</strong>
                <small>{voice.hint}</small>
              </button>
            ))}
            {visibleVoiceOptions.length === 0 ? <div className="voice-lab-voice-empty">没有匹配的音色</div> : null}
          </div>
        </div>
        <Segmented label="语速" value={String(voiceSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setVoiceSpeed(Number(value))} />
        <div className="provider-line">当前音色：{selectedVoiceLabel} · {voiceId}{voiceProvider === 'volcengine' ? ` · ${currentVolcengineConfig.resourceId || 'seed-tts-2.0'}` : ` · ${state.config.tts.minimax.model}`}</div>
        {submitError ? <ErrorSummaryButton compact title="配音实验室提交失败" fullMessage={submitError} /> : null}
        <InlineActionFeedback feedback={voiceLabAction.feedback} />
        <button className="primary-action" onClick={generatePreview} disabled={generating || !text.trim() || !voiceId}>
          {generating ? <Loader2 className="spin" size={17} /> : <Mic2 size={17} />}
          {generating ? '生成中' : '生成试听'}
        </button>
      </section>
      <section className="local-lab-media voice-lab-history">
        <div className="panel-title-row">
          <div>
            <h2>历史试听</h2>
            <span className="hint-text">{state.voiceLabRecords.length} 条本地记录</span>
          </div>
        </div>
        {state.voiceLabRecords.length === 0 ? <EmptyState title="暂无配音试听" /> : null}
        {state.voiceLabRecords.map((record) => (
          <article className={`voice-record ${record.status}`} key={record.id}>
            <div className="voice-record-head">
              <strong>{record.voiceLabel}</strong>
              <small>{record.provider} · {record.speed}x · {formatDate(record.createdAt)}</small>
            </div>
            <p>{record.text}</p>
            {record.audioPath ? <audio className="voice-lab-player" data-media-canvas="voice-lab" controls preload="metadata" src={toLocalAssetUrl(record.audioPath)} /> : null}
            {!record.audioPath && record.status === 'failed' ? <div className="voice-lab-player error">未生成音频</div> : null}
            {record.errorMessage ? <ErrorSummaryButton compact title="配音失败" fullMessage={record.errorMessage} /> : null}
            {record.audioPath ? <small>{record.audioPath}</small> : null}
          </article>
        ))}
      </section>
    </div>
  );
}
