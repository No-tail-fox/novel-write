import { TextField } from '../../ui';
import { defaultLemoProductionBudget, type LemoProductionBudget } from '../../shared/lemo-production-budget';

export function LemoBudgetFields({ value, disabled, onChange }: {
  value?: LemoProductionBudget; disabled?: boolean; onChange(value: LemoProductionBudget): void;
}) {
  const budget = value ?? defaultLemoProductionBudget();
  const fields: Array<{ key: keyof LemoProductionBudget; label: string; min: number; max: number; step?: number }> = [
    { key: 'maxOutputTokens', label: '单次最大输出 Token', min: 256, max: 1000000 },
    { key: 'maxRequests', label: '整片最多模型请求', min: 1, max: 256 },
    { key: 'maxTurns', label: '每阶段最多模型轮次', min: 1, max: 100 },
    { key: 'maxMinutes', label: '整片执行时限（分钟）', min: 1, max: 240 },
    { key: 'maxEstimatedCostUsd', label: 'Messages SDK 估算费用上限（美元）', min: 0.01, max: 1000, step: 0.01 },
    { key: 'maxRepairRounds', label: '最多画面修复轮次', min: 0, max: 8 },
  ];
  return <details className="vox-settings-disclosure"><summary>创意动画执行预算</summary>
    <div className="vox-production-fields">{fields.map(field => <TextField key={field.key} label={field.label}
      type="number" min={field.min} max={field.max} step={field.step ?? 1} disabled={disabled}
      value={Number.isFinite(budget[field.key]) ? String(budget[field.key]) : ''}
      onChange={(_, event) => onChange({ ...budget, [field.key]: event.value.trim() ? Number(event.value) : NaN })} />)}</div>
    <p className="vox-hint">只导出最终有声 MP4。预算随制作记录保存，恢复沿用原上限。时限从首次创作开始计算，包含暂停时间。Messages SDK 金额按每次执行保守累计；Chat / Responses 试用执行器按请求数、单次输出 Token 和总时限限制，不提供美元费用上限。中转计价和图片、配音费用以对应服务商为准。修复轮次与自动复审共享；达到上限会停止后续请求，保留已完成结果。</p>
  </details>;
}
