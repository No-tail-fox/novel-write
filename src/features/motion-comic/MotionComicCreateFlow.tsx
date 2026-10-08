import type { ReactElement } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Clapperboard,
  FileText,
  Loader2,
  Scissors,
  Sparkles,
  Upload,
} from 'lucide-react';
import type {
  MotionComicAdaptationMode,
  MotionComicPipelineData,
  MotionComicSourceKind,
  MotionComicSplitStrategy,
} from '../../shared/motion-comic';
import type { MotionComicSourceSplitEvidence } from '../../shared/motion-comic-episode-planning';
import { Button, Pane, SegmentedControl, TextAreaField, TextField, Toolbar } from '../../ui';

export interface MotionComicEpisodeDraft {
  title: string;
  sourceText: string;
  startUnitId?: string;
  endUnitId?: string;
  splitReason?: string;
  continuityHook?: string;
}
interface MotionComicCreateFlowProps {
  step: number;
  title: string;
  ratio: MotionComicPipelineData['ratio'];
  sourceKind: MotionComicSourceKind;
  adaptationMode: MotionComicAdaptationMode;
  sourceFileName: string;
  sourceText: string;
  targetCharacters: string;
  targetDurationSec: string;
  splitInstructions: string;
  splitStrategy?: MotionComicSplitStrategy;
  splitEvidence?: MotionComicSourceSplitEvidence | null;
  splitWarnings?: readonly string[];
  onSplitStrategyChange?: (strategy: MotionComicSplitStrategy) => void;
  episodes: readonly MotionComicEpisodeDraft[];
  busy: boolean;
  feedback?: string;
  errorMessage?: string;
  onStepChange: (step: number) => void;
  onTitleChange: (value: string) => void;
  onRatioChange: (value: MotionComicPipelineData['ratio']) => void;
  onSourceKindChange: (value: MotionComicSourceKind) => void;
  onAdaptationModeChange: (value: MotionComicAdaptationMode) => void;
  onSourceTextChange: (value: string) => void;
  onTargetCharactersChange: (value: string) => void;
  onTargetDurationSecChange: (value: string) => void;
  onSplitInstructionsChange: (value: string) => void;
  onEpisodeChange: (index: number, update: Partial<MotionComicEpisodeDraft>) => void;
  onImportFile: () => void;
  onPrepareEpisodes: () => void;
  onCreate: () => void;
}
const STEPS = [
  { label: '剧本导入', icon: <FileText size={14} /> },
  { label: '分集确认', icon: <Scissors size={14} /> },
  { label: '创建项目', icon: <Clapperboard size={14} /> },
] as const;

export function MotionComicCreateFlow({
  step,
  title,
  ratio,
  sourceKind,
  adaptationMode,
  sourceFileName,
  sourceText,
  targetCharacters,
  targetDurationSec,
  splitInstructions,
  splitStrategy = 'chapter',
  splitEvidence,
  splitWarnings = [],
  onSplitStrategyChange,
  episodes,
  busy,
  feedback,
  errorMessage,
  onStepChange,
  onTitleChange,
  onRatioChange,
  onSourceKindChange,
  onAdaptationModeChange,
  onSourceTextChange,
  onTargetCharactersChange,
  onTargetDurationSecChange,
  onSplitInstructionsChange,
  onEpisodeChange,
  onImportFile,
  onPrepareEpisodes,
  onCreate,
}: MotionComicCreateFlowProps): ReactElement {
  const sourceReady = Boolean(title.trim() && sourceText.trim());
  const aiSplit = splitStrategy === 'ai-story';
  const episodesReady = episodes.length > 0
    && episodes.every((episode) => episode.title.trim() && episode.sourceText.trim())
    && (!aiSplit || (splitEvidence?.strategy === 'ai-story' && episodes.every((episode) => (
      episode.startUnitId && episode.endUnitId && episode.splitReason?.trim() && episode.continuityHook?.trim()
    ))));
  const sourceCharacters = sourceText.trim().length;
  const splitStrategyLabel = splitStrategy === 'ai-story' ? 'AI 剧情分集' : splitStrategy === 'length' ? '按字数规则' : '按章节规则';

  function continueFlow() {
    if (step === 0) {
      if (aiSplit) onStepChange(1);
      else onPrepareEpisodes();
    }
    else onStepChange(Math.min(2, step + 1));
  }

  return (
    <div className="motion-comic-create" data-motion-comic-create-flow data-step={step}>
      <div className="motion-comic-create__page">
        <header className="motion-comic-create__header">
          <span className="motion-comic-create__mark"><Clapperboard size={20} /></span>
          <div><h1>新建 AI 漫剧</h1><p>先确定源文和分集，再进入人物、分镜与视频制作。</p></div>
        </header>

        <nav className="motion-comic-create__steps" aria-label="创建步骤">
          {STEPS.map((item, index) => (
            <Button
              key={item.label}
              density="compact"
              variant="subtle"
              className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
              aria-current={index === step ? 'step' : undefined}
              disabled={busy || index > step}
              icon={index < step ? <Check size={14} /> : item.icon}
              onClick={() => onStepChange(index)}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        <div className="motion-comic-create__layout">
          <Pane as="main" tone="base" className="motion-comic-create__main">
            <div className="motion-comic-create__section-heading">
              <div className="motion-comic-create__section-title">
                <span>步骤 {step + 1} / 3</span>
                <h2>{STEPS[step].label}</h2>
              </div>

            </div>

            {step === 0 ? <div className="motion-comic-create__fields">
              <div className="motion-comic-create__row">
                <TextField label="项目名称" value={title} placeholder="例如：雨夜来信" onChange={(_, data) => onTitleChange(data.value)} />
                <SegmentedControl label="成片画幅" value={ratio} options={(['9:16', '16:9', '1:1', '4:3'] as const).map((value) => ({ value, label: value }))} onChange={onRatioChange} />
              </div>
              <div className="motion-comic-create__row">
                <SegmentedControl label="源文类型" value={sourceKind} options={[
                  { value: 'script', label: '剧本' },
                  { value: 'novel', label: '小说' },
                ]} onChange={onSourceKindChange} />
                <SegmentedControl label="处理方式" value={adaptationMode} options={[
                  { value: 'faithful-script', label: '按现有剧本' },
                  { value: 'novel-adaptation', label: '小说改编' },
                ]} onChange={onAdaptationModeChange} />
              </div>
              <div className="motion-comic-source-import">
                <Toolbar aria-label="源文导入">
                  <Button variant="secondary" icon={<Upload size={14} />} disabled={busy} onClick={onImportFile}>上传 TXT / MD</Button>
                  <span>{sourceFileName || '也可以直接粘贴正文'}</span>
                </Toolbar>
                <TextAreaField
                  label={sourceKind === 'novel' ? '小说正文' : '剧本正文'}
                  value={sourceText}
                  placeholder={sourceKind === 'novel' ? '粘贴小说章节或上传文本文件' : '粘贴完整剧本或上传文本文件'}
                  resize="vertical"
                  hint={`${sourceCharacters.toLocaleString('zh-CN')} 字`}
                  onChange={(_, data) => onSourceTextChange(data.value)}
                />
              </div>
            </div> : null}

            {step === 1 ? <div className="motion-comic-create__fields">
              <div className="motion-comic-split-toolbar">
                <SegmentedControl
                  label="拆分规则"
                  value={splitStrategy}
                  options={[
                    { value: 'chapter', label: '按章节' },
                    { value: 'length', label: '按字数' },
                    { value: 'ai-story', label: 'AI 剧情分集' },
                  ]}
                  onChange={(val) => onSplitStrategyChange?.(val as MotionComicSplitStrategy)}
                />
                <TextField label="每集目标字数" value={targetCharacters} inputMode="numeric" onChange={(_, data) => onTargetCharactersChange(data.value)} />
                <Button
                  variant={aiSplit ? 'primary' : 'secondary'}
                  icon={busy ? <Loader2 className="director-spin" size={14} /> : aiSplit ? <Sparkles size={14} /> : <Scissors size={14} />}
                  disabled={busy || !sourceText.trim()}
                  onClick={onPrepareEpisodes}
                >
                  {aiSplit ? '生成 AI 分集' : '重新拆分'}
                </Button>
                <span>{episodes.length} 集 · 共 {sourceCharacters.toLocaleString('zh-CN')} 字</span>
              </div>
              {aiSplit ? <div className="motion-comic-ai-split-settings">
                <TextField
                  label="每集目标时长（秒，可选）"
                  value={targetDurationSec}
                  inputMode="numeric"
                  placeholder="例如 90"
                  onChange={(_, data) => onTargetDurationSecChange(data.value)}
                />
                <TextAreaField
                  label="分集要求（可选）"
                  value={splitInstructions}
                  placeholder="例如：每集结尾保留悬念，不拆断同一段对话"
                  resize="vertical"
                  onChange={(_, data) => onSplitInstructionsChange(data.value)}
                />
                <div className="motion-comic-ai-split-note">
                  <Sparkles size={16} />
                  <span><strong>边界规划</strong><small>模型只选择原文单元的起止位置；每集正文由本地原文重建并校验连续覆盖。</small></span>
                </div>
              </div> : <p className="motion-comic-split-hint">规则拆分不会调用 AI；可直接调整标题和每集原文。</p>}
              {aiSplit && splitEvidence ? <div className="motion-comic-ai-split-result" role="status">
                <Check size={16} />
                <span>
                  <strong>{splitEvidence.repaired ? '自动修复后已通过校验' : 'AI 分集已通过校验'}</strong>
                  <small>{splitEvidence.model ?? '当前文本模型'} · {splitEvidence.sourceUnitCount ?? 0} 个原文单元 · {splitEvidence.batchCount ?? 1} 批</small>
                </span>
              </div> : null}
              {splitWarnings.length > 0 ? <div className="motion-comic-ai-split-warnings">
                {splitWarnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div> : null}
              <div className="motion-comic-episode-drafts">
                {episodes.map((episode, index) => (
                  <section key={index} className="motion-comic-episode-draft">
                    <header>
                      <span>EP {String(index + 1).padStart(2, '0')}</span>
                      <strong>{episode.startUnitId && episode.endUnitId ? `${episode.startUnitId} → ${episode.endUnitId} · ` : ''}{episode.sourceText.length.toLocaleString('zh-CN')} 字</strong>
                    </header>
                    <TextField label={`第 ${index + 1} 集标题`} value={episode.title} onChange={(_, data) => onEpisodeChange(index, { title: data.value })} />
                    {aiSplit ? <div className="motion-comic-episode-draft__evidence">
                      <span><strong>拆分依据</strong><small>{episode.splitReason}</small></span>
                      <span><strong>尾钩与承接</strong><small>{episode.continuityHook}</small></span>
                    </div> : null}
                    <TextAreaField
                      label={`第 ${index + 1} 集源文${aiSplit ? '（按边界重建）' : ''}`}
                      value={episode.sourceText}
                      readOnly={aiSplit}
                      resize="vertical"
                      onChange={aiSplit ? undefined : (_, data) => onEpisodeChange(index, { sourceText: data.value })}
                    />
                  </section>
                ))}
              </div>
            </div> : null}

            {step === 2 ? <div className="motion-comic-create__review">
              <section><span>01</span><div><strong>源文已保存</strong><small>{sourceFileName || '粘贴正文'} · {sourceKind === 'novel' ? '小说' : '剧本'} · {sourceCharacters.toLocaleString('zh-CN')} 字</small></div></section>
              <section><span>02</span><div><strong>分集方案已确认</strong><small>{splitStrategyLabel} · {episodes.length} 集；创建后逐集生成分幕、场次、人物与分镜预览。</small></div></section>
              <section><span>03</span><div><strong>生成服务稍后选择</strong><small>建立项目不会调用图片、视频、配音或文本生成接口。</small></div></section>
            </div> : null}

            {feedback ? <div className="motion-comic-create__feedback is-success" role="status">{feedback}</div> : null}
            {errorMessage ? <div className="motion-comic-create__feedback is-error" role="alert">{errorMessage}</div> : null}

            <Toolbar aria-label="创建流程操作" className="motion-comic-create__footer">
              <Button variant="subtle" icon={<ArrowLeft size={14} />} disabled={step === 0 || busy} onClick={() => onStepChange(step - 1)}>上一步</Button>
              {step < 2 ? <Button variant="primary" icon={<ArrowRight size={14} />} iconPosition="after" disabled={busy || (step === 0 ? !sourceReady : !episodesReady)} onClick={continueFlow}>下一步</Button>
                : <Button variant="primary" icon={busy ? <Loader2 className="director-spin" size={15} /> : <Clapperboard size={15} />} disabled={busy || !sourceReady || !episodesReady} onClick={onCreate}>创建漫剧项目</Button>}
            </Toolbar>
          </Pane>

          <aside className="motion-comic-create__summary" aria-label="创建摘要">
            <h2>项目摘要</h2>
            <dl>
              <div><dt>项目</dt><dd>{title || '待填写'}</dd></div>
              <div><dt>源文</dt><dd>{sourceKind === 'novel' ? '小说' : '剧本'}</dd></div>
              <div><dt>方式</dt><dd>{adaptationMode === 'novel-adaptation' ? '小说改编' : '按现有剧本'}</dd></div>
              <div><dt>拆分</dt><dd>{splitStrategyLabel}</dd></div>
              <div><dt>分集</dt><dd>{episodes.length || '待拆分'}</dd></div>
              <div><dt>画幅</dt><dd>{ratio}</dd></div>
            </dl>
            <div className="motion-comic-create__route">
              <strong>后续流程</strong>
              <span>分集 → 分幕分场 → 角色资产 → 分镜图 → 远程视频 → 配音合成 → 导出</span>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
