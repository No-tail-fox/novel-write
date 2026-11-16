import { AspectRatioField } from '../../components/AspectRatioField';
import { CreationPageHeader } from '../../components/CreationPageHeader';
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import '../../styles/features/creation-chapter.css';
import { defaultCustomStyles } from '../../shared/config';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Clapperboard,
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
import { Button, Pane, SegmentedControl, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';

const VISUAL_STYLES = ['photo-real', 'modern-film', 'ghibli', 'watercolor', 'pixar-3d', 'ink']
  .flatMap((id) => defaultCustomStyles.filter((style) => style.id === id))
  .map((style) => ({ label: style.name, value: `${style.name}：${style.prefix}；${style.suffix}` }));

export interface MotionComicEpisodeDraft {
  title: string;
  sourceText: string;
  startUnitId?: string;
  endUnitId?: string;
  splitReason?: string;
  continuityHook?: string;
}
interface MotionComicCreateFlowProps {
  models?: ReactNode;
  step: number;
  title: string;
  ratio: MotionComicPipelineData['ratio'];
  visualStyle?: string;
  onVisualStyleChange?: (value: string) => void;
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
  services?: readonly { id: string; label: string; model: string; ready: boolean; detail?: string; onConfigure?: () => void }[];
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
  { label: '剧本导入' },
  { label: '分集确认' },
  { label: '创建项目' },
] as const;

export function MotionComicCreateFlow({
  models,
  step,
  title,
  ratio,
  visualStyle = '',
  onVisualStyleChange,
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
  services = [],
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
  const [customStyleSelected, setCustomStyleSelected] = useState(false);
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);
  const chapterListId = useId();
  const selectedStyle = VISUAL_STYLES.find((style) => style.value === visualStyle);
  const customStyle = customStyleSelected || Boolean(visualStyle && !selectedStyle);
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
        <CreationPageHeader
          title="新建 AI 漫剧"
          description="先确定源文和分集，再进入人物、分镜与视频制作。"
          icon={<Clapperboard size={20} />}
        />

        <nav className="motion-comic-create__steps creation-page-steps" aria-label="创建步骤">
          {STEPS.map((item, index) => (
            <Button
              key={item.label}
              variant="subtle"
              className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
              aria-current={index === step ? 'step' : undefined}
              disabled={busy || index > step}
              onClick={() => onStepChange(index)}
            >
              <span>{index < step ? <Check size={13} /> : index + 1}</span><strong>{item.label}</strong>
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
              {models}
              <div className="motion-comic-create__row">
                <TextField label="项目名称" value={title} placeholder="例如：雨夜来信" onChange={(_, data) => onTitleChange(data.value)} />
                <AspectRatioField label="成片画幅" value={ratio} onChange={onRatioChange} />
              </div>
              <SelectField
                label="视觉风格（可选）"
                value={customStyle ? 'custom' : visualStyle}
                options={[{ value: '', label: '暂不指定' }, ...VISUAL_STYLES, { value: 'custom', label: '自定义' }]}
                hint="将用于角色、场景参考图和视频生成；创建后可在系列视觉规则中修改。"
                disabled={busy}
                onChange={(_, data) => {
                  setCustomStyleSelected(data.value === 'custom');
                  onVisualStyleChange?.(data.value === 'custom' ? '' : data.value);
                }}
              />
              {customStyle ? <TextField
                label="自定义视觉风格（可选）"
                value={visualStyle}
                maxLength={4000}
                placeholder="描述画面质感、色彩或绘画方式"
                disabled={busy}
                onChange={(_, data) => onVisualStyleChange?.(data.value)}
              /> : null}
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
              <details className="motion-comic-split-options" open={aiSplit}>
                <summary>拆分设置 · {splitStrategyLabel} · {episodes.length} 集（点击调整）</summary>
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
              </details>
              <section className="creation-chapters" aria-label="分集草稿">
                <div className="creation-chapters__heading">
                  <h2>确认拆分后的章节</h2>
                  <p>{sourceFileName || '粘贴正文'} · 共 {episodes.length} 集 · 展开逐集核对，创建时保留全部分集</p>
                </div>
                <div className="creation-chapters__columns" aria-hidden="true">
                  <span>集号</span><span>章节标题</span><span>字数</span><span>检查</span><span>操作</span>
                </div>
                {episodes.length === 0 ? <p className="creation-chapters__empty">尚未拆分章节，请展开拆分设置并生成分集。</p> : null}
                {episodes.map((episode, index) => {
                  const expanded = expandedEpisode === index;
                  const issue = !episode.title.trim() ? '标题待补充' : !episode.sourceText.trim() ? '正文待补充'
                    : aiSplit && !(splitEvidence?.strategy === 'ai-story' && episode.startUnitId && episode.endUnitId && episode.splitReason?.trim() && episode.continuityHook?.trim()) ? '边界待校验' : '';
                  const editorId = `${chapterListId}-episode-${index}`;
                  return <section key={index} className="creation-chapters__item" data-expanded={expanded}>
                    <div className="creation-chapters__row">
                      <span className="creation-chapters__number">{String(index + 1).padStart(2, '0')}</span>
                      <strong className="creation-chapters__title">{episode.title.trim() || '未命名章节'}</strong>
                      <span className="creation-chapters__count">{episode.sourceText.length.toLocaleString('zh-CN')}<span className="creation-chapters__unit"> 字</span></span>
                      <span className="creation-chapters__status" data-valid={!issue}>{issue || '内容完整'}</span>
                      <Button variant="secondary" aria-expanded={expanded} aria-controls={expanded ? editorId : undefined}
                        aria-label={`${expanded ? '收起' : '预览编辑'}第 ${index + 1} 集`}
                        onClick={() => setExpandedEpisode(expanded ? null : index)}>{expanded ? '收起' : '预览编辑'}</Button>
                    </div>
                    {expanded ? <div id={editorId} className="creation-chapters__editor">
                      <TextField label={`第 ${index + 1} 集标题`} value={episode.title} disabled={busy} onChange={(_, data) => onEpisodeChange(index, { title: data.value })} />
                      {aiSplit ? <div className="motion-comic-episode-draft__evidence">
                        <span><strong>原文边界</strong><small>{episode.startUnitId || '待校验'} → {episode.endUnitId || '待校验'} · 正文只读</small></span>
                        <span><strong>拆分依据</strong><small>{episode.splitReason}</small></span>
                        <span><strong>尾钩与承接</strong><small>{episode.continuityHook}</small></span>
                      </div> : null}
                      <TextAreaField
                        label={`第 ${index + 1} 集源文${aiSplit ? '（按边界重建）' : ''}`}
                        value={episode.sourceText}
                        readOnly={aiSplit}
                        disabled={busy}
                        resize="vertical"
                        onChange={aiSplit ? undefined : (_, data) => onEpisodeChange(index, { sourceText: data.value })}
                      />
                      {issue ? <p className="creation-chapters__issue" role="status">{issue}，请{issue === '边界待校验' ? '重新生成 AI 分集并通过校验' : '补充后再继续'}。</p> : null}
                    </div> : null}
                  </section>;
                })}
              </section>
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
              <div><dt>风格</dt><dd>{selectedStyle?.label || visualStyle.trim() || '暂不指定'}</dd></div>
            </dl>
            {services.length > 0 ? <section className="motion-comic-create__services" aria-label="制作服务就绪情况">
              <strong>制作服务</strong>
              <p>创建后将固定使用本项目所选模型。远程视频未就绪时，制作会停在视频生成前。</p>
              {services.map((service) => <div key={service.id} data-ready={service.ready}>
                <div><strong>{service.label}</strong><span>{service.ready ? '已配置' : '待配置'}</span></div>
                <small>{service.model}</small>
                {!service.ready && service.detail ? <small>{service.detail}</small> : null}
                {service.onConfigure ? <Button variant="subtle" density="compact" onClick={service.onConfigure}>配置{service.label}</Button> : null}
              </div>)}
            </section> : null}
            <div className="motion-comic-create__route">
              <strong>后续流程</strong>
              <span>分集 → 分幕分场与分镜 → 资产参考图 → 视频生成 → 配音合成 → 导出</span>
              <small>默认使用角色、场景和道具参考图直接生成视频；分镜图按需制作。</small>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
