import { useState } from 'react';
import { ImagePlus, Loader2, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult, TaskSummary } from '../../shared/types';
import { Button, Dialog, TextAreaField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { toLocalImageUrl } from '../tasks/task-formatters';

export function ProjectCoverDialog({ task, api, onUpdated, onClose }: {
  task: TaskSummary;
  api: StoryDreamApi;
  onUpdated: (result: AppMutationResult) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(() => [
    `为作品《${task.title || '未命名作品'}》创作一张完整的封面插画。`,
    task.inputPreview ? `作品内容：${task.inputPreview}` : '',
    '画面主题鲜明，构图完整，主体清晰，不添加文字或水印。',
  ].filter(Boolean).join('\n'));
  const [failedPreview, setFailedPreview] = useState(false);
  const [operation, setOperation] = useState('');
  const coverAction = useAsyncAction();
  const busy = coverAction.busy;
  function finish(result: AppMutationResult) {
    if (!result) return;
    onUpdated(result);
    onClose();
  }
  async function generateCover() {
    setOperation('generate');
    await coverAction.run(async () => finish(await api.generateProjectCover({ id: task.id, prompt: prompt.trim() })));
  }
  async function importCover() {
    setOperation('import');
    await coverAction.run(async () => finish(await api.importProjectCover(task.id)));
  }
  async function resetCover() {
    setOperation('reset');
    await coverAction.run(async () => finish(await api.resetProjectCover(task.id)));
  }
  const path = task.projectCover?.path;
  return (
    <Dialog open title="项目封面" onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      surfaceClassName="project-cover-dialog"
      actions={<>
        <Button variant="subtle" disabled={busy} onClick={() => void resetCover()} icon={<RotateCcw size={15} />}>恢复自动封面</Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>关闭</Button>
        <Button variant="primary" disabled={busy || !prompt.trim()} onClick={() => void generateCover()}
          icon={busy && operation === 'generate' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}>
          {busy && operation === 'generate' ? '正在生成' : coverAction.feedback?.tone === 'error' && operation === 'generate' ? '重试生成' : '生成封面'}
        </Button>
      </>}>
      <div className="project-cover-editor" aria-busy={busy}>
        <div className="project-cover-preview">
          {path && !failedPreview ? <img src={`${toLocalImageUrl(path)}?v=${encodeURIComponent(task.projectCover?.revision ?? '')}`}
            alt={`${task.title}封面预览`} onError={() => setFailedPreview(true)} /> : <ImagePlus size={28} aria-label="暂无封面" />}
        </div>
        <div className="project-cover-fields">
          <strong>{task.title || '未命名作品'}</strong>
          <Button variant="secondary" disabled={busy} onClick={() => void importCover()} icon={<Upload size={15} />}>上传封面</Button>
          <TextAreaField label="封面提示词" value={prompt} maxLength={4000} rows={5} disabled={busy}
            onChange={(event) => setPrompt(event.target.value)} />
        </div>
      </div>
      <InlineActionFeedback feedback={coverAction.feedback} />
    </Dialog>
  );
}
