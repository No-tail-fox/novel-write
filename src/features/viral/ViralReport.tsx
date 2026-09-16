import { useEffect, useState } from 'react';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { Button, SegmentedControl, TextAreaField, TextField } from '../../ui';
import type { ViralAnalysisResult } from '../../shared/types';
import { trimForPreview } from '../tasks/task-formatters';

type ViralInsightTab = 'copy' | 'prompt';

export function ViralReport({
  result,
  readOnly,
  createProductionTask,
  saveTemplates,
}: {
  result: ViralAnalysisResult;
  readOnly: boolean;
  createProductionTask: () => void;
  saveTemplates: (input: { storyTemplateName: string; imageTemplateName: string }) => Promise<void>;
}) {
  const [insightTab, setInsightTab] = useState<ViralInsightTab>('copy');
  const defaultTemplateBaseName = viralTemplateBaseName(result);
  const [storyTemplateName, setStoryTemplateName] = useState(`爆款故事模板 - ${defaultTemplateBaseName}`);
  const [imageTemplateName, setImageTemplateName] = useState(`爆款图片模板 - ${defaultTemplateBaseName}`);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState('');
  const breakdown = result.contentBreakdown;
  const frames = uniqueViralPromptFrames(result.frames);
  const keyFrameCount = frames.length;
  const originalCopy = viralTranscriptText(result);
  const recreationAvailable = result.recreationState !== 'not-requested';

  useEffect(() => {
    setStoryTemplateName(`爆款故事模板 - ${defaultTemplateBaseName}`);
    setImageTemplateName(`爆款图片模板 - ${defaultTemplateBaseName}`);
    setTemplateSaveError('');
  }, [defaultTemplateBaseName]);

  async function handleSaveTemplates() {
    const nextStoryName = storyTemplateName.trim();
    const nextImageName = imageTemplateName.trim();
    if (!nextStoryName || !nextImageName || savingTemplates) return;
    setSavingTemplates(true);
    setTemplateSaveError('');
    try {
      await saveTemplates({ storyTemplateName: nextStoryName, imageTemplateName: nextImageName });
    } catch (error) {
      setTemplateSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTemplates(false);
    }
  }

  return (
    <div data-media-canvas="viral-report">
      <div className="viral-report-grid">
        <ViralReportCard title="开头" value={breakdown.opening.type} detail={breakdown.opening.analysis} />
        <ViralReportCard title="结构" value={breakdown.structure.type} detail={breakdown.structure.analysis} />
        <ViralReportCard title="结尾" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
        <ViralReportCard title="爆点" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
      </div>
      <div className="viral-frame-insights">
        <div className="viral-insight-tabs">
          <SegmentedControl label="图文拆解视图" value={insightTab} onChange={setInsightTab} options={[{ value: 'copy', label: '文案拆解' }, { value: 'prompt', label: '提示词拆解' }]} />
          <span className="viral-keyframe-count">关键帧数量：{keyFrameCount}</span>
        </div>
        {insightTab === 'copy' ? (
          <div className="viral-copy-breakdown">
            <section className="viral-original-copy">
              <span>原文案</span>
              <p>{originalCopy || '暂无转写文案。可以先确认语音转文字配置，或查看下方标题、开头、结构与爆点拆解。'}</p>
            </section>
            <div className="viral-copy-grid">
              <ViralCopyCard title="标题文案" value={breakdown.title.original || result.source.title || '未识别标题'} detail={breakdown.title.pattern} />
              <ViralCopyCard title="开头话术" value={breakdown.opening.type} detail={breakdown.opening.analysis} />
              <ViralCopyCard title="结尾话术" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
              <ViralCopyCard title="爆点表达" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
            </div>
          </div>
        ) : (
          <div className="viral-insight-list">
            {frames.map((frame) => (
              <article className="viral-insight-card" key={`${frame.timestamp}-${frame.framePath}`}>
                <span>{formatViralFrameTimestamp(frame.timestamp)} · 生图提示词拆解</span>
                <strong>{frameImagePrompt(frame)}</strong>
                <p>{framePromptDetail(frame)}</p>
              </article>
            ))}
            {frames.length === 0 ? <p className="muted-text">暂无关键帧提示词拆解结果</p> : null}
          </div>
        )}
      </div>
      {recreationAvailable ? <div className="viral-followup-panel">
        <h3>后续操作</h3>
        <p>{result.recreation.blueprint}</p>
        <TextAreaField label="复刻文案" value={result.recreation.script} readOnly />
        <div className="viral-template-name-grid">
          <TextField label="故事模板名" value={storyTemplateName} onChange={(event) => setStoryTemplateName(event.target.value)} />
          <TextField label="图片模板名" value={imageTemplateName} onChange={(event) => setImageTemplateName(event.target.value)} />
        </div>
        {templateSaveError ? <p className="form-error">{templateSaveError}</p> : null}
        <div className="viral-followup-actions">
          <Button variant="primary" disabled={readOnly || savingTemplates || !storyTemplateName.trim() || !imageTemplateName.trim()} onClick={() => void handleSaveTemplates()}>
            {savingTemplates ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            {savingTemplates ? '保存中' : '保存为模板'}
          </Button>
          <Button className="viral-create-production-task" disabled={readOnly} onClick={createProductionTask}>
            <Wand2 size={16} />
            生成新任务
          </Button>
        </div>
      </div> : null}
    </div>
  );
}

function viralTranscriptText(result: ViralAnalysisResult): string {
  return result.transcript.map((segment) => segment.text.trim()).filter(Boolean).join('\n');
}

function viralTemplateBaseName(result: ViralAnalysisResult): string {
  return trimForPreview(result.source.title || result.contentBreakdown.topic || '短视频', 18);
}

function frameImagePrompt(frame: ViralAnalysisResult['frames'][number]): string {
  return frame.imagePrompt || [
    frame.shotType,
    frame.composition,
    frame.visualDescription,
    frame.mood,
    frame.keyElements.length ? `关键元素：${frame.keyElements.join('、')}` : '',
  ].filter(Boolean).join('，');
}

function framePromptDetail(frame: ViralAnalysisResult['frames'][number]): string {
  return [
    frame.visualDescription,
    frame.textOverlay ? `画面文字：${frame.textOverlay}` : '',
    frame.keyElements.length ? `关键元素：${frame.keyElements.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function uniqueViralPromptFrames(frames: ViralAnalysisResult['frames']): ViralAnalysisResult['frames'] {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    const signature = [
      frame.imagePrompt,
      frame.visualDescription,
      frame.textOverlay ?? '',
      frame.composition,
    ].map((item) => item.trim()).filter(Boolean).join('|') || `${frame.timestamp}-${frame.framePath}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function ViralCopyCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-insight-card viral-copy-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function formatViralFrameTimestamp(timestamp: number): string {
  return `${Math.max(0, Math.round(timestamp))}s`;
}

function ViralReportCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-report-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
