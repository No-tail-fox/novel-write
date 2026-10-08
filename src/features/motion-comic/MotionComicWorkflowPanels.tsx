import '../../styles/features/motion-comic.css';
import { useState, type ReactElement } from 'react';
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Layers3,
  Plus,
  Scissors,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { extractDialogueFromScript } from '../../shared/motion-comic-dialogue';
import { resolveMotionComicSceneAct } from '../../shared/motion-comic';
import type {
  MotionComicDramaticScene,
  MotionComicEpisode,
  MotionComicPipelineData,
  MotionComicSourceEpisode,
  MotionComicWorkflowStage,
} from '../../shared/motion-comic';
import { Button, Pane, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';

interface CommonPanelProps {
  document: MotionComicPipelineData;
  onContinue: (stage: MotionComicWorkflowStage) => void;
}

export function MotionComicSourcePanel({ document, onContinue }: CommonPanelProps): ReactElement {
  const source = document.sourceDocument;
  const sourceText = source?.originalText ?? document.series.premise;
  const splitEvidence = source?.splitEvidence;
  const splitLabel = splitEvidence?.strategy === 'ai-story' ? 'AI 剧情分集' : splitEvidence?.strategy === 'length' ? '按字数规则' : splitEvidence ? '按章节规则' : '历史分集';
  return (
    <div className="motion-comic-stage-panel motion-comic-source-panel" data-motion-comic-stage-panel="source">
      <header className="motion-comic-stage-panel__heading">
        <span><FileText size={18} /></span>
        <div>
          <p>01 · 剧本导入</p>
          <h1>{source?.fileName || document.title}</h1>
          <small>{source ? `${source.kind === 'novel' ? '小说' : '剧本'} · ${source.adaptationMode === 'novel-adaptation' ? '小说改编' : '按现有剧本'} · ${sourceText.length.toLocaleString('zh-CN')} 字` : '历史项目 · 使用系列核心设定作为源文'}</small>
        </div>
      </header>
      <div className="motion-comic-source-panel__layout">
        <Pane tone="base" className="motion-comic-source-panel__document">
          <TextAreaField label="原始文本" value={sourceText} rows={22} resize="vertical" readOnly hint="原稿在分集与规划阶段保持不变，已生成内容通过版本记录管理。" />
        </Pane>
        <aside className="motion-comic-source-panel__summary">
          <section><strong>导入状态</strong><span className="is-ready"><CheckCircle2 size={15} />源文已保存</span></section>
          <dl>
            <div><dt>计划集数</dt><dd>{source?.episodes.length ?? document.episodes.length}</dd></div>
            <div><dt>分集方式</dt><dd>{splitLabel}</dd></div>
            {splitEvidence?.model ? <div><dt>分集模型</dt><dd>{splitEvidence.model}</dd></div> : null}
            <div><dt>成片画幅</dt><dd>{document.ratio}</dd></div>
            <div><dt>导入时间</dt><dd>{source ? new Date(source.importedAt).toLocaleString('zh-CN') : '历史项目'}</dd></div>
          </dl>
          <Button variant="primary" icon={<ArrowRight size={14} />} iconPosition="after" onClick={() => onContinue('episodes')}>进入分集拆解</Button>
        </aside>
      </div>
    </div>
  );
}

interface EpisodePanelProps extends CommonPanelProps {
  selectedSourceEpisodeId: string;
  plannedSourceEpisodeIds: ReadonlySet<string>;
  nextSourceEpisodeId?: string;
  onSelectSourceEpisode: (id: string) => void;
  onPlanEpisode: (id?: string) => void;
  onSelectGeneratedEpisode: (id: string) => void;
}

export function MotionComicEpisodesPanel({
  document,
  selectedSourceEpisodeId,
  plannedSourceEpisodeIds,
  nextSourceEpisodeId,
  onSelectSourceEpisode,
  onPlanEpisode,
  onSelectGeneratedEpisode,
  onContinue,
}: EpisodePanelProps): ReactElement {
  const sourceEpisodes = document.sourceDocument?.episodes ?? [];
  const selected = sourceEpisodes.find((episode) => episode.id === selectedSourceEpisodeId) ?? sourceEpisodes[0];
  const selectedGenerated = selected ? document.episodes.find((episode) => (
    episode.planningEvidence?.sourceEpisodeId === selected.id
    || (!episode.planningEvidence?.sourceEpisodeId && episode.planningEvidence?.sourceText.trim() === selected.sourceText.trim())
  )) : undefined;
  const selectedCanPlan = Boolean(selected && selected.id === nextSourceEpisodeId);
  const generatedEpisodes = document.episodes.filter((episode) => episode.scenes.length > 0);
  const selectedActCount = selectedGenerated
    ? new Set(selectedGenerated.scenes.map((scene, index) => resolveMotionComicSceneAct(scene, index, selectedGenerated.scenes.length).actIndex)).size
    : 0;

  // 1. 分段切片、检索与状态筛选
  const CHUNK_SIZE = 20;
  const totalCount = sourceEpisodes.length;
  const chunkCount = Math.ceil(totalCount / CHUNK_SIZE);
  const currentChunkIdx = selected ? Math.floor((selected.number - 1) / CHUNK_SIZE) : 0;
  const [selectedChunk, setSelectedChunk] = useState<number>(chunkCount > 1 ? currentChunkIdx : -1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredEpisodes = sourceEpisodes.filter((ep) => {
    const isPlanned = plannedSourceEpisodeIds.has(ep.id);
    if (statusFilter === 'planned' && !isPlanned) return false;
    if (statusFilter === 'pending' && isPlanned) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const numMatch = String(ep.number).includes(q) || `ep${ep.number}`.includes(q) || `第${ep.number}集`.includes(q);
      const titleMatch = ep.title.toLowerCase().includes(q);
      if (!numMatch && !titleMatch) return false;
    } else if (selectedChunk !== -1 && chunkCount > 1) {
      const chunkIdx = Math.floor((ep.number - 1) / CHUNK_SIZE);
      if (chunkIdx !== selectedChunk) return false;
    }

    return true;
  });

  const currentIndex = sourceEpisodes.findIndex((e) => e.id === selected?.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < sourceEpisodes.length - 1;

  const navigateEpisode = (delta: number) => {
    const target = sourceEpisodes[currentIndex + delta];
    if (target) {
      onSelectSourceEpisode(target.id);
      const targetChunk = Math.floor((target.number - 1) / CHUNK_SIZE);
      if (selectedChunk !== -1 && targetChunk !== selectedChunk) {
        setSelectedChunk(targetChunk);
      }
    }
  };

  return (
    <div className="motion-comic-stage-panel motion-comic-episodes-panel" data-motion-comic-stage-panel="episodes">
      <header className="motion-comic-stage-panel__heading">
        <span><Scissors size={18} /></span>
        <div>
          <p>02 · 分集拆解</p>
          <h1>确认每集内容，再逐集生成结构</h1>
          <small>{plannedSourceEpisodeIds.size}/{totalCount} 集已完成结构化 · 结构化会在确认后写入分集、分幕与分场</small>
        </div>
      </header>

      {/* 结构化总览进度条 */}
      <div className="motion-comic-episodes-progress-bar">
        <div className="motion-comic-episodes-progress-info">
          <span>结构化总进度：{plannedSourceEpisodeIds.size} / {totalCount} 集</span>
          <strong>{totalCount > 0 ? Math.round((plannedSourceEpisodeIds.size / totalCount) * 100) : 0}%</strong>
        </div>
        <div className="motion-comic-progress-track">
          <div
            className="motion-comic-progress-fill"
            style={{ width: `${totalCount > 0 ? (plannedSourceEpisodeIds.size / totalCount) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="motion-comic-episodes-panel__layout">
        {/* 左侧分集列表与高级筛选 */}
        <aside className="motion-comic-episode-source-list">
          <header className="motion-comic-episode-source-list__header">
            <strong>剧本原稿分集 ({filteredEpisodes.length}/{totalCount})</strong>
            <small>选择一集后，在右侧顶部点击「生成剧本与分幕预览」</small>
          </header>

          {/* 筛选与检索控制区 - 全部使用 Button 与 TextField，避免原生 control 标签 */}
          <div className="motion-comic-episodes-filter-bar">
            <div className="motion-comic-episodes-search-box">
              <TextField
                label=""
                placeholder="搜索集数或标题..."
                value={searchQuery}
                onChange={(_, data) => setSearchQuery(data.value)}
              />
            </div>

            <div className="motion-comic-episodes-status-tabs">
              <Button
                variant={statusFilter === 'all' ? 'primary' : 'subtle'}
                density="compact"
                onClick={() => setStatusFilter('all')}
              >
                全部 ({totalCount})
              </Button>
              <Button
                variant={statusFilter === 'planned' ? 'primary' : 'subtle'}
                density="compact"
                onClick={() => setStatusFilter('planned')}
              >
                已完成 ({plannedSourceEpisodeIds.size})
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'primary' : 'subtle'}
                density="compact"
                onClick={() => setStatusFilter('pending')}
              >
                待处理 ({totalCount - plannedSourceEpisodeIds.size})
              </Button>
            </div>

            {chunkCount > 1 && !searchQuery.trim() ? (
              <div className="motion-comic-episodes-chunk-tabs">
                <Button
                  variant={selectedChunk === -1 ? 'primary' : 'subtle'}
                  density="compact"
                  onClick={() => setSelectedChunk(-1)}
                >
                  全集
                </Button>
                {Array.from({ length: chunkCount }).map((_, idx) => {
                  const startNum = idx * CHUNK_SIZE + 1;
                  const endNum = Math.min((idx + 1) * CHUNK_SIZE, totalCount);
                  return (
                    <Button
                      key={idx}
                      variant={selectedChunk === idx ? 'primary' : 'subtle'}
                      density="compact"
                      onClick={() => setSelectedChunk(idx)}
                    >
                      {startNum}-{endNum}
                    </Button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="motion-comic-episode-source-list__items">
            {filteredEpisodes.map((episode) => {
              const isSelected = episode.id === selected?.id;
              const isPlanned = plannedSourceEpisodeIds.has(episode.id);
              const isNext = episode.id === nextSourceEpisodeId;
              return (
                <div
                  key={episode.id}
                  className={`motion-comic-source-episode-item ${isSelected ? 'is-selected' : ''}`}
                >
                  <Button
                    variant="subtle"
                    className="motion-comic-source-episode"
                    aria-pressed={isSelected}
                    onClick={() => onSelectSourceEpisode(episode.id)}
                  >
                    <span className="motion-comic-ep-tag">EP {String(episode.number).padStart(2, '0')}</span>
                    <span className="motion-comic-ep-title">{episode.title}</span>
                    <span className="motion-comic-ep-chars">{episode.sourceText.length} 字</span>
                    {isPlanned ? (
                      <span className="motion-comic-ep-badge is-planned"><CheckCircle2 size={13} /> 已完成</span>
                    ) : isNext ? (
                      <span className="motion-comic-ep-badge is-next"><Sparkles size={13} /> 可开始</span>
                    ) : (
                      <span className="motion-comic-ep-badge is-locked">待解锁</span>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* 右侧详情与操作区 */}
        <section className="motion-comic-episode-source-detail">
          {selected ? (
            <>
              <header className="motion-comic-episode-detail-header">
                <div>
                  <div className="motion-comic-detail-eyebrow">
                    <span className="motion-comic-detail-ep-num">EP {String(selected.number).padStart(2, '0')}</span>
                    <span>{selected.sourceText.length.toLocaleString('zh-CN')} 字</span>
                  </div>
                  <h2>{selected.title}</h2>
                </div>
                <div className="motion-comic-episode-nav-btns">
                  <Button
                    variant="subtle"
                    density="compact"
                    icon={<ChevronLeft size={14} />}
                    disabled={!hasPrev}
                    onClick={() => navigateEpisode(-1)}
                  >
                    上一集
                  </Button>
                  <Button
                    variant="subtle"
                    density="compact"
                    icon={<ChevronRight size={14} />}
                    iconPosition="after"
                    disabled={!hasNext}
                    onClick={() => navigateEpisode(1)}
                  >
                    下一集
                  </Button>
                </div>
              </header>

              {selectedGenerated ? (
                <div className="motion-comic-episode-plan-state is-planned">
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>已完成分幕与分场结构化</strong>
                    <p>已生成 {selectedActCount} 幕 · {selectedGenerated.scenes.length} 场，包含人物、剧情与镜头设定。</p>
                  </div>
                  <Button
                    variant="secondary"
                    icon={<Layers3 size={14} />}
                    onClick={() => { onSelectGeneratedEpisode(selectedGenerated.id); onContinue('scenes'); }}
                  >
                    查看分幕分场
                  </Button>
                </div>
              ) : selectedCanPlan ? (
                <div className="motion-comic-episode-plan-state is-ready">
                  <Sparkles size={18} />
                  <div>
                    <strong>当前集已准备就绪</strong>
                    <p>将基于原稿智能提取人物对白、叙事目标、场次与机位动作。</p>
                    <small>不会直接调用图片或视频服务</small>
                  </div>
                  <Button
                    variant="primary"
                    density="spacious"
                    icon={<Sparkles size={16} />}
                    onClick={() => onPlanEpisode(selected.id)}
                  >
                    生成剧本与分幕预览
                  </Button>
                </div>
              ) : (
                <div className="motion-comic-episode-plan-state is-waiting">
                  <CircleAlert size={18} />
                  <div>
                    <strong>等待前一集完成</strong>
                    <span>完成前一集后自动解锁</span>
                    <p>为保证人物形象与前后剧情因果连续性，建议按故事序逐集推进结构化。</p>
                  </div>
                </div>
              )}

              {selected.startUnitId && selected.endUnitId ? <div className="motion-comic-source-boundary-evidence">
                <span><strong>原文边界</strong><small>{selected.startUnitId} → {selected.endUnitId}</small></span>
                <span><strong>拆分依据</strong><small>{selected.splitReason}</small></span>
                <span><strong>尾钩与承接</strong><small>{selected.continuityHook}</small></span>
              </div> : null}

              <div className="motion-comic-episode-text-viewport">
                <TextAreaField
                  label="本集剧本源文"
                  value={selected.sourceText}
                  rows={14}
                  resize="vertical"
                  readOnly
                  hint="源文内容仅供对照与智能拆解，修改请至项目源文重新导入。"
                />
              </div>

            </>
          ) : null}

          {generatedEpisodes.length > 0 ? (
            <footer className="motion-comic-episodes-footer">
              <Button
                variant="primary"
                icon={<ArrowRight size={14} />}
                iconPosition="after"
                onClick={() => onContinue('scenes')}
              >
                进入分幕分场审核 ({generatedEpisodes.length} 集已就绪)
              </Button>
            </footer>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export { MotionComicScenesPanel } from './MotionComicScenesPanel';

export function MotionComicEmptyStructuredPanel({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <div className="motion-comic-stage-empty">
      <BookOpenText size={22} />
      <strong>还没有可审核的分幕分场</strong>
      <span>先在分集阶段生成并确认至少一集结构。</span>
      <Button variant="primary" icon={<ArrowRight size={14} />} onClick={onBack}>
        返回分集拆解
      </Button>
    </div>
  );
}
