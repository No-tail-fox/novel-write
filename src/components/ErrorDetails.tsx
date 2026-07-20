import { useId, useState } from 'react';

export interface ErrorDetailsProps {
  fullMessage: string;
  title: string;
  compact?: boolean;
}

export function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '发生错误';
  const imageApiStatus = normalized.match(/Image provider API error \((\d+)\)/i)?.[1];
  if (imageApiStatus) return `生图接口错误 ${imageApiStatus}`;
  if (/Python dependency .* is required|ModuleNotFoundError: No module named/i.test(normalized)) {
    const missing = normalized.match(/No module named ['"]([^'"]+)['"]/i)?.[1] ?? normalized.match(/Python dependency ([\w.-]+)/i)?.[1];
    return missing ? `Python 运行时缺少依赖：${missing}` : 'Python 运行时依赖缺失';
  }
  if (normalized.includes(['Browser preview', 'cannot run the real provider pipeline'].join(' ')) || /浏览器预览无法运行真实供应商流水线/i.test(normalized)) return '浏览器预览无法执行真实任务';
  if (/Image provider API key is missing/i.test(normalized)) return '生图 API Key 缺失';
  if (/Image provider is not configured/i.test(normalized)) return '生图配置不完整';
  if (/Jimeng submit failed/i.test(normalized)) return '即梦提交失败';
  if (/Jimeng poll failed/i.test(normalized)) return '即梦结果获取失败';
  if (/LLM provider is not configured/i.test(normalized)) return 'LLM 配置不完整';
  if (/TTS provider is not configured/i.test(normalized)) return 'TTS 配置不完整';
  const firstSentence = normalized.split(/[。.!?]/u)[0] || normalized;
  return firstSentence.length > 42 ? `${firstSentence.slice(0, 42)}...` : firstSentence;
}

export function ErrorDetails({ fullMessage, title, compact = false }: ErrorDetailsProps) {
  const [open, setOpen] = useState(false);
  if (!fullMessage.trim()) return null;
  const summary = summarizeErrorMessage(fullMessage);
  return (
    <>
      <button
        type="button"
        className={compact ? 'error-summary-button compact' : 'error-summary-button'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="error-mark">!</span>
        <span>{summary}</span>
      </button>
      {open ? <ErrorDetailDialog title={title} summary={summary} fullMessage={fullMessage} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

interface ErrorDetailDialogProps {
  title: string;
  summary: string;
  fullMessage: string;
  onClose: () => void;
}

function ErrorDetailDialog({ title, summary, fullMessage, onClose }: ErrorDetailDialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <div className="error-dialog-backdrop" onClick={onClose}>
      <section
        className="error-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="error-dialog-head">
          <div>
            <span className="error-mark">!</span>
            <strong id={titleId}>{title}</strong>
          </div>
          <button className="mini-button" type="button" onClick={onClose}>关闭</button>
        </div>
        <p id={descriptionId}>{summary}</p>
        <pre>{fullMessage}</pre>
      </section>
    </div>
  );
}
