import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog } from '../ui';
import { isImageProviderTextOnlyResponse } from '../shared/image-provider-error';

export interface ErrorDetailsProps {
  fullMessage: string;
  title: string;
  compact?: boolean;
}

export function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '发生错误';
  if (/LEMO_CANVAS_STATE/iu.test(normalized)) return '绘图状态未正确恢复，已阻止错误成片';
  if (/LEMO_TEXTS/iu.test(normalized)) return '字幕未通过实际画面检查，需修复后继续';
  if (/^LLM API error \(400\) at step/iu.test(normalized)) return '文本模型服务拒绝请求（HTTP 400），请检查模型与接口配置';
  if (/LLM_JSON_TRUNCATED/iu.test(normalized)) return '导演方案输出预算耗尽，请检查模型输出预算';
  if (/LLM_JSON_INVALID/iu.test(normalized)) return '模型回复不是有效 JSON，未进入后续制作';
  if (/LLM_STREAM_INTERRUPTED/iu.test(normalized)) return '文本接收中断，云端结果待核对';
  if (/LEMO_EDIT_TRUNCATED/iu.test(normalized)) return '本批输出预算耗尽，上一批源码已保存';
  if (/LEMO_EDIT_LIMIT/iu.test(normalized)) return '已达单文件创作批次上限，工程已保存';
  if (/LEMO_EDIT_(?:INVALID|STALE|SIZE|EMPTY|NOOP|AMBIGUOUS)/iu.test(normalized)) return '本批修改未通过检查，上一批源码已保留';
  if (/LEMO_FILE_TRUNCATED/iu.test(normalized)) return '代码输出预算耗尽，已保留不完整源码';
  if (/UND_ERR_CONNECT_TIMEOUT/iu.test(normalized)) return '服务连接超时';
  if (/UND_ERR_SOCKET|ECONNRESET/iu.test(normalized)) return '网络连接中断';
  if (/ENOTFOUND|EAI_AGAIN/iu.test(normalized)) return '服务域名解析失败';
  if (/Image generation is not enabled for this group|分组未开通生图/iu.test(normalized)) return '图片服务分组未开通生图';
  if (/No available compatible accounts|No available channel for model\s|没有可用于模型.*上游账号或通道/iu.test(normalized)) {
    return '图片服务暂无可用账号';
  }
  if (/Image provider.*\(402\)|金币余额不足|账户余额不足|套餐额度不可用/iu.test(normalized)) {
    return '图片服务余额不足';
  }
  if (/Image provider.*\(400\)/iu.test(normalized) && isImageProviderTextOnlyResponse(normalized)) {
    return '图片服务未返回图片';
  }
  const imageTimeout = normalized.match(/Image provider (?:request|edit request|async submit|async poll) timed out after (\d+)ms/iu);
  if (imageTimeout) return `生图等待超时（${Number(imageTimeout[1]) / 1000} 秒）`;
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
