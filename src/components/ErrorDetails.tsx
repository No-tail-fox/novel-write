import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog } from '../ui';

export interface ErrorDetailsProps {
  fullMessage: string;
  title: string;
  compact?: boolean;
}

export function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '发生错误';
  if (/No available compatible accounts|没有可用于模型.*上游账号或通道/iu.test(normalized)) {
    return '图片服务暂无可用账号';
  }
  if (/Image provider.*\(402\)|金币余额不足|账户余额不足|套餐额度不可用/iu.test(normalized)) {
    return '图片服务余额不足';
  }
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
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      trigger={<Button
        variant="subtle"
        density={compact ? 'compact' : 'comfortable'}
        className={compact ? 'error-summary-button compact' : 'error-summary-button'}
        icon={<AlertCircle className="error-mark" size={18} />}
        onClick={(event) => event.stopPropagation()}
      >{summary}</Button>}
      actions={<Button onClick={(event) => { event.stopPropagation(); setOpen(false); }}>关闭</Button>}
    >
      <div className="sd-error-details" onClick={(event) => event.stopPropagation()}>
        <p>{summary}</p>
        <pre>{fullMessage}</pre>
      </div>
    </Dialog>
  );
}
