import { useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Flag, MessageSquare, Play, Plus, Sparkles, Trash2, Upload, Volume2, WandSparkles } from 'lucide-react';
import type { ProductionSubtitleCue } from '../../shared/production-workflow';
import { isSubtitleAlignmentValid } from '../../shared/audio-alignment';
import type {
  MotionComicSpeakerRole,
  MotionComicBubbleStyle,
  MotionComicBubblePosition,
  ExtractedDialogueItem,
} from '../../shared/motion-comic-dialogue';
import {
  extractDialogueFromScript,
  distributeDialogueTiming,
  BUBBLE_POSITION_PRESETS,
  BubblePositionPresetKey,
  resolvePresetFromPosition,
} from '../../shared/motion-comic-dialogue';
import { Button, CheckboxField, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';

export interface DirectorSubtitleCue extends ProductionSubtitleCue {
  characterId?: string;
  speakerName?: string;
  speakerRole?: MotionComicSpeakerRole;
  bubbleStyle?: MotionComicBubbleStyle;
  bubblePosition?: MotionComicBubblePosition;
  emotion?: string;
  voiceAssetVersionId?: string;
}

export type DirectorSubtitlePatch = Partial<Pick<
  DirectorSubtitleCue,
  'text' | 'startMs' | 'endMs' | 'characterId' | 'speakerName' | 'speakerRole' | 'bubbleStyle' | 'bubblePosition' | 'emotion'
>>;

export interface DirectorSubtitleInspectorProps {
  cues: readonly DirectorSubtitleCue[];
  focusCueId?: string;
  shotStartMs: number;
  durationMs: number;
  busy: boolean;
  style: string;
  safeAreaVisible: boolean;
  characters?: readonly { value: string; label: string }[];
  voiceConnected?: boolean;
  shotPrompt?: string;
  onGenerateVoice?: (id: string) => void;
  onBatchGenerateVoice?: () => void;
  onUpdate: (id: string, patch: DirectorSubtitlePatch) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onAlign: (id: string) => void;
  onBatchApplyCues?: (cues: DirectorSubtitleCue[], mode: 'replace' | 'append') => void;
  /** Import a local JSON/SRT/VTT transcript with explicit word/segment clocks. */
  onImportTimestamps?: (id: string) => void;
  onSeek: (timeMs: number) => void;
  onStyleChange: (style: string) => void;
  onSafeAreaChange: (visible: boolean) => void;
}

const sourceLabels = { provider: '服务时间戳', whisper: 'Whisper 对齐', manual: '人工对齐', estimated: '估算对齐' } as const;

const ROLE_BORDER_COLORS: Record<string, string> = {
  narrative: '#64748b',
  linxia: '#8b5cf6',
  luxun: '#3b82f6',
  jiangche: '#10b981',
};

function getBorderColor(cue: DirectorSubtitleCue) {
  if (cue.speakerRole === 'narrative') return ROLE_BORDER_COLORS.narrative;
  const key = (cue.characterId || cue.speakerName || '').toLowerCase();
  if (key.includes('旁白') || key.includes('narrator')) return ROLE_BORDER_COLORS.narrative;
  if (key.includes('林') || key.includes('lin')) return ROLE_BORDER_COLORS.linxia;
  if (key.includes('陆') || key.includes('lu')) return ROLE_BORDER_COLORS.luxun;
  if (key.includes('江') || key.includes('jiang')) return ROLE_BORDER_COLORS.jiangche;
  return '#6366f1';
}

export function DirectorSubtitleInspector(props: DirectorSubtitleInspectorProps) {
  const [error, setError] = useState('');
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [scriptInput, setScriptInput] = useState(props.shotPrompt || '');
  const [extractedPreview, setExtractedPreview] = useState<ExtractedDialogueItem[] | null>(null);

  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleParseScript = () => {
    const textToParse = scriptInput.trim() || props.shotPrompt || '';
    if (!textToParse) {
      setError('请输入分镜剧本文本或分镜描述。');
      return;
    }
    const items = extractDialogueFromScript(textToParse, props.characters);
    if (items.length === 0) {
      setError('未能识别出对话台词，请确保剧本格式如“林夏：台词”或“（旁白）台词”。');
      return;
    }
    setExtractedPreview(items);
    setError('');
  };

  const handleApplyExtracted = (mode: 'replace' | 'append') => {
    if (!extractedPreview || extractedPreview.length === 0) return;
    const timed = distributeDialogueTiming(extractedPreview, props.shotStartMs, props.durationMs);
    const newCues: DirectorSubtitleCue[] = timed.map((item, idx) => ({
      id: `cue-gen-${Date.now()}-${idx}`,
      shotId: props.cues[0]?.shotId || '',
      text: item.text,
      startMs: item.startMs,
      endMs: item.endMs,
      characterId: item.characterId,
      speakerName: item.speakerName,
      speakerRole: item.speakerRole,
      bubbleStyle: item.bubbleStyle,
      // bubblePosition not extracted directly
      bubblePosition: undefined,
      emotion: item.emotion,
    }));

    if (props.onBatchApplyCues) {
      props.onBatchApplyCues(newCues, mode);
    } else {
      // Fallback: 如果没有传 onBatchApplyCues，逐句应用
      if (mode === 'replace') {
        props.cues.forEach((c) => props.onRemove(c.id));
      }
      newCues.forEach((c) => {
        props.onAdd();
      });
    }

    setExtractedPreview(null);
    setExtractorOpen(false);
  };

  // 统计角色数与配音覆盖
  const totalCues = props.cues.length;
  const voicedCues = props.cues.filter((c) => Boolean(c.voiceAssetVersionId)).length;
  const uniqueSpeakers = new Set(props.cues.map((c) => c.characterId || c.speakerName || '旁白')).size;

  return (
    <section className="director-form-stack director-cue-editor" aria-label="逐句字幕编辑" data-director-subtitle-editor="true">
      {/* 顶部统计流与智能提取入口 */}
      <div className="director-dialogue-summary-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={14} style={{ color: 'var(--shell-accent, #6366f1)' }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>对白流 ({totalCues} 句)</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {uniqueSpeakers} 个角色 · 配音覆盖 {voicedCues}/{totalCues}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {props.onGenerateVoice && totalCues > 0 ? (
            <Button
              density="compact"
              variant="subtle"
              title="一键为所有未配音对白生成专属语音"
              disabled={props.busy || voicedCues === totalCues}
              onClick={() => {
                if (props.onBatchGenerateVoice) {
                  props.onBatchGenerateVoice();
                } else {
                  props.cues.forEach((c) => {
                    if (!c.voiceAssetVersionId) {
                      props.onGenerateVoice?.(c.id);
                    }
                  });
                }
              }}
            >
              <Volume2 size={13} />
              批量配音
            </Button>
          ) : null}
          <Button
            density="compact"
            variant="subtle"
            onClick={() => setExtractorOpen(!extractorOpen)}
          >
            <Bot size={13} />
            智能提取
            {extractorOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </Button>
        </div>
      </div>

      {/* 智能对白提取抽屉 */}
      {extractorOpen && (
        <div
          style={{
            background: 'var(--card-bg, #1a1e24)',
            border: '1px solid var(--shell-border, #334155)',
            borderRadius: 6,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', justifyContent: 'space-between' }}>
            <span>从分镜剧本提取对话与气泡</span>
            {props.shotPrompt && (
              <Button
                density="compact"
                variant="subtle"
                onClick={() => setScriptInput(props.shotPrompt || '')}
              >
                载入镜头 Prompt
              </Button>
            )}
          </div>
          <TextAreaField
            label="分镜剧本文本"
            value={scriptInput}
            onChange={(_, data) => setScriptInput(data.value)}
            placeholder="支持：林夏：（愤怒）不要过来！\n陆巡：（冷笑）你逃不掉的。\n（旁白）窗外的雨越来越大。"
            resize="vertical"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <Button density="compact" variant="primary" onClick={handleParseScript}>
              <Sparkles size={13} />
              分析提取
            </Button>
          </div>

          {extractedPreview && extractedPreview.length > 0 && (
            <div
              style={{
                marginTop: 6,
                padding: 8,
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--shell-accent, #6366f1)' }}>
                成功解析 {extractedPreview.length} 句对白：
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {extractedPreview.map((item, idx) => (
                  <div key={idx} style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{item.speakerName || '角色'}:</span>
                    {item.emotion && <span style={{ opacity: 0.7 }}>[{item.emotion}]</span>}
                    <span style={{ opacity: 0.9 }}>{item.text}</span>
                    <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 10 }}>
                      ({item.bubbleStyle === 'speech' ? '气泡' : item.bubbleStyle === 'thought' ? '想法' : item.bubbleStyle === 'shout' ? '怒吼' : '字幕'})
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <Button density="compact" variant="secondary" onClick={() => handleApplyExtracted('replace')}>
                  替换当前所有对白
                </Button>
                <Button density="compact" variant="subtle" onClick={() => handleApplyExtracted('append')}>
                  追加到末尾
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 连续多角色对白流卡片列表 */}
      <div className="director-dialogue-stream" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {props.cues.map((cueItem, index) => {
          const borderColor = getBorderColor(cueItem);
          const isFocused = cueItem.id === props.focusCueId;

          return (
            <div
              key={cueItem.id}
              className={`director-dialogue-card ${isFocused ? 'is-focused' : ''}`}
              style={{
                borderLeft: `4px solid ${borderColor}`,
                background: 'var(--card-bg, #181d24)',
                borderTop: '1px solid var(--shell-border, #28303d)',
                borderRight: '1px solid var(--shell-border, #28303d)',
                borderBottom: '1px solid var(--shell-border, #28303d)',
                borderRadius: '0 6px 6px 0',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {/* 卡片头部：角色、气泡形态、操作按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>#{index + 1}</span>
                  {props.characters ? (
                    <div style={{ width: 140 }}>
                      <SelectField
                        label=""
                        value={cueItem.characterId ?? ''}
                        disabled={props.busy}
                        options={[{ value: '', label: '旁白 · 默认音色' }, ...props.characters]}
                        onChange={(event) => run(() => props.onUpdate(cueItem.id, { characterId: event.target.value }))}
                      />
                    </div>
                  ) : null}
                  <div style={{ width: 104 }}>
                    <SelectField
                      label=""
                      value={cueItem.bubbleStyle ?? 'speech'}
                      disabled={props.busy}
                      options={[
                        { value: 'speech', label: '对白气泡' },
                        { value: 'thought', label: '内心想法' },
                        { value: 'shout', label: '怒吼爆发' },
                        { value: 'caption', label: '底部字幕' },
                      ]}
                      onChange={(event) =>
                        run(() => props.onUpdate(cueItem.id, { bubbleStyle: event.target.value as MotionComicBubbleStyle }))
                      }
                    />
                  </div>
                  <div style={{ width: 96 }}>
                    <SelectField
                      label=""
                      value={resolvePresetFromPosition(cueItem.bubblePosition)}
                      disabled={props.busy || cueItem.bubbleStyle === 'caption'}
                      title={cueItem.bubbleStyle === 'caption' ? '底部字幕位置固定' : '选择漫画气泡在 16:9 画布上的落点'}
                      options={[
                        { value: 'auto', label: '自动落点' },
                        { value: 'top-left', label: '↖ 左上' },
                        { value: 'top-right', label: '↗ 右上' },
                        { value: 'center-left', label: '⬅ 左侧' },
                        { value: 'center-right', label: '➡ 右侧' },
                        { value: 'bottom-center', label: '⬇ 下方' },
                      ]}
                      onChange={(event) => {
                        const preset = event.target.value as BubblePositionPresetKey;
                        const targetPos = BUBBLE_POSITION_PRESETS[preset];
                        run(() => props.onUpdate(cueItem.id, { bubblePosition: targetPos }));
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    density="compact"
                    variant="subtle"
                    title="定位播放本句"
                    disabled={props.busy}
                    onClick={() => props.onSeek(cueItem.startMs)}
                  >
                    <Play size={12} />
                  </Button>
                  <Button
                    density="compact"
                    variant="subtle"
                    title="删除本句"
                    disabled={props.busy}
                    onClick={() => run(() => props.onRemove(cueItem.id))}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>

              {/* 台词正文 TextArea */}
              <TextAreaField
                fieldClassName="director-prompt-field"
                label=""
                value={cueItem.text}
                placeholder="输入台词内容..."
                disabled={props.busy}
                onChange={(_, data) => run(() => props.onUpdate(cueItem.id, { text: data.value }))}
                resize="vertical"
              />

              {/* 情绪微调与时间控制 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 120 }}>
                  <TextField
                    label="情绪标签"
                    value={cueItem.emotion ?? ''}
                    placeholder="正常 / 愤怒 / 紧张"
                    disabled={props.busy}
                    onChange={(_, data) => run(() => props.onUpdate(cueItem.id, { emotion: data.value }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <CueTimeFields
                    key={cueItem.id}
                    cue={cueItem}
                    shotStartMs={props.shotStartMs}
                    durationMs={props.durationMs}
                    disabled={props.busy}
                    onUpdate={(patch) => props.onUpdate(cueItem.id, patch)}
                  />
                </div>
              </div>

              {/* 配音生成与逐词对齐状态 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {cueItem.tokens?.length ? (
                    <span>
                      {isSubtitleAlignmentValid(cueItem)
                        ? sourceLabels[cueItem.alignmentSource ?? 'manual']
                        : '对齐已失效'}{' '}
                      · {cueItem.tokens.length} 词
                    </span>
                  ) : (
                    <span>未对齐</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    density="compact"
                    variant="subtle"
                    disabled={props.busy || !cueItem.text.trim()}
                    onClick={() => run(() => props.onAlign(cueItem.id))}
                  >
                    <WandSparkles size={12} />
                    逐词估算
                  </Button>
                  {props.onGenerateVoice ? (
                    <Button
                      density="compact"
                      variant="secondary"
                      disabled={props.busy || !props.voiceConnected || !cueItem.text.trim()}
                      onClick={() => props.onGenerateVoice?.(cueItem.id)}
                    >
                      <Volume2 size={12} />
                      {cueItem.voiceAssetVersionId ? '重配' : '生成配音'}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* 逐词时间戳点选预览 */}
              {cueItem.tokens?.length ? (
                <div className="director-cue-tokens" aria-label="逐词时间预览" style={{ marginTop: 2 }}>
                  {cueItem.tokens.map((token, tokenIdx) => (
                    <Button
                      key={`${cueItem.id}-${tokenIdx}`}
                      density="compact"
                      variant="subtle"
                      title={`${((token.startMs - props.shotStartMs) / 1000).toFixed(3)}–${((token.endMs - props.shotStartMs) / 1000).toFixed(3)} 秒`}
                      onClick={() => props.onSeek(token.startMs)}
                    >
                      {token.text}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {props.cues.length === 0 && (
          <div className="director-inspector-note">当前镜头还没有对白。点击下方“新增一句”或上方“智能提取”开始创作。</div>
        )}
      </div>

      <Toolbar aria-label="字幕句子操作" className="director-cue-actions">
        <Button density="compact" variant="subtle" disabled={props.busy} onClick={() => run(props.onAdd)}>
          <Plus size={13} />
          新增一句台词
        </Button>
      </Toolbar>

      {error ? <div className="director-inspector-note is-warning" role="alert">{error}</div> : null}

      <SelectField
        label="字幕样式"
        value={props.style}
        disabled={props.busy}
        options={[
          { value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' },
          { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' },
        ]}
        onChange={(event) => props.onStyleChange(event.target.value)}
      />
      <CheckboxField
        label="显示安全区提示"
        checked={props.safeAreaVisible}
        onChange={(_, data) => props.onSafeAreaChange(Boolean(data.checked))}
      />
      <div className="director-inspector-note">
        <Flag size={14} />
        <span>漫画气泡浮层直接悬浮于画布上方；底部字幕适用于旁白或传统字幕。修改台词文本后可重新生成专属音色配音。</span>
      </div>
    </section>
  );
}

function CueTimeFields({
  cue,
  shotStartMs,
  durationMs,
  disabled,
  onUpdate,
}: {
  cue: DirectorSubtitleCue;
  shotStartMs: number;
  durationMs: number;
  disabled: boolean;
  onUpdate: (patch: DirectorSubtitlePatch) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setStart(((cue.startMs - shotStartMs) / 1000).toFixed(3));
    setEnd(((cue.endMs - shotStartMs) / 1000).toFixed(3));
    setError('');
  }, [cue.startMs, cue.endMs, shotStartMs]);

  const save = () => {
    const startMs = Math.round(Number(start) * 1000);
    const endMs = Math.round(Number(end) * 1000);
    if (
      !start.trim() ||
      !end.trim() ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > durationMs
    ) {
      setError(`时间须位于 0–${durationMs / 1000} 秒内，结束晚于开始。`);
      return;
    }
    try {
      onUpdate({ startMs: shotStartMs + startMs, endMs: shotStartMs + endMs });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="director-cue-time-editor" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <TextField label="起(s)" value={start} disabled={disabled} onChange={(_, data) => setStart(data.value)} />
      <TextField label="止(s)" value={end} disabled={disabled} onChange={(_, data) => setEnd(data.value)} />
      <Button density="compact" variant="subtle" disabled={disabled} onClick={save}>
        应用
      </Button>
      {error ? <div role="alert" className="director-inspector-note is-warning">{error}</div> : null}
    </div>
  );
}

/** Preserve authored spaces; only highlight verified tokens while the cue is active. */
export function DirectorSubtitlePreview({ cue, timeMs }: { cue: ProductionSubtitleCue; timeMs: number }) {
  if (!cue.tokens?.length || !isSubtitleAlignmentValid(cue)) return <>{cue.text}</>;
  let cursor = 0;
  const content = cue.tokens.map((token, index) => {
    const position = cue.text.indexOf(token.text, cursor);
    if (position < cursor) return null;
    const prefix = cue.text.slice(cursor, position);
    cursor = position + token.text.length;
    return (
      <span key={index}>
        {prefix}
        <span className={timeMs >= token.startMs && timeMs < token.endMs ? 'director-subtitle-word is-active' : 'director-subtitle-word'}>
          {token.text}
        </span>
      </span>
    );
  });
  return (
    <>
      {content}
      {cue.text.slice(cursor)}
    </>
  );
}
