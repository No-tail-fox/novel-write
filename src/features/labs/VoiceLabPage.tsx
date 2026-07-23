import { useEffect, useState } from 'react';
import { Loader2, Mic2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { defaultTaskSpeakerForProvider, normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider, type RuntimeTtsProvider } from '../../shared/tts-voices';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate, toLocalAssetUrl } from '../tasks/task-formatters';

export function VoiceLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [text, setText] = useState('配音实验室试听文案：用稳定、清晰、有情绪的声音讲完这一段故事。');
  const [voiceProvider, setVoiceProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const voiceLabAction = useAsyncAction();
  const voiceOptions = ttsVoiceOptionsForProvider(voiceProvider);
  const selectedVoiceLabel = taskSpeakerLabel(voiceProvider, voiceId);

  useEffect(() => {
    const options = ttsVoiceOptionsForProvider(voiceProvider);
    if (!options.some((option) => option.id === voiceId)) {
      setVoiceId(defaultTaskSpeakerForProvider(voiceProvider, state.config));
    }
  }, [state.config, voiceId, voiceProvider]);

  function changeProvider(provider: string) {
    const nextProvider = normalizeRuntimeTtsProvider(provider);
    setVoiceProvider(nextProvider);
    setVoiceId(defaultTaskSpeakerForProvider(nextProvider, state.config));
  }

  async function generatePreview() {
    if (generating || !text.trim()) return;
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
    <div className="voice-lab-layout lab-layout">
      <section className="panel">
        <Field label="试听文案">
          <textarea className="prompt-box voice-lab-text" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <Segmented label="配音模型" value={voiceProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={changeProvider} />
        <div className="voice-lab-voices">
          <span className="field-title">音色</span>
          <div className="chip-row">
            {voiceOptions.map((voice) => (
              <button key={voice.id} className={voiceId === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setVoiceId(voice.id)}>
                <strong>{voice.label}</strong>
                <small>{voice.hint}</small>
              </button>
            ))}
          </div>
        </div>
        <Segmented label="语速" value={String(voiceSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setVoiceSpeed(Number(value))} />
        <div className="provider-line">当前音色：{selectedVoiceLabel} · {voiceId}</div>
        {submitError ? <ErrorSummaryButton compact title="配音实验室提交失败" fullMessage={submitError} /> : null}
        <InlineActionFeedback feedback={voiceLabAction.feedback} />
        <button className="primary-action" onClick={generatePreview} disabled={generating || !text.trim()}>
          {generating ? <Loader2 className="spin" size={17} /> : <Mic2 size={17} />}
          {generating ? '生成中' : '生成试听'}
        </button>
      </section>
      <section className="panel voice-lab-history" data-media-canvas="voice-lab">
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
            {record.audioPath ? <audio className="voice-lab-player" controls preload="metadata" src={toLocalAssetUrl(record.audioPath)} /> : null}
            {!record.audioPath && record.status === 'failed' ? <div className="voice-lab-player error">未生成音频</div> : null}
            {record.errorMessage ? <ErrorSummaryButton compact title="配音失败" fullMessage={record.errorMessage} /> : null}
            {record.audioPath ? <small>{record.audioPath}</small> : null}
          </article>
        ))}
      </section>
    </div>
  );
}
