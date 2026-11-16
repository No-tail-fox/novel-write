import { useState } from 'react';
import { CheckboxField, SelectField, TextField } from '../../ui';
import type { VoxProductionSettings } from '../../shared/vox-production';
import { CODE_VIDEO_DURATION_PRESETS, codeVideoCaptionMode, codeVideoTargetDurationSchema, newCodeVideoPolicy, type CodeVideoPolicy } from '../../shared/creative-animation/production-policy';

export interface CodeVideoPolicyFieldsProps {
  value?: CodeVideoPolicy;
  onChange(value: CodeVideoPolicy): void;
  onValidityChange?(valid: boolean): void;
  busy?: boolean;
  authoringVersion?: number;
  piMaxRequests?: number;
  onPiMaxRequestsChange?(value: number): void;
}

/** Missing legacy policy is displayed without writing defaults back to the project. */
export function CodeVideoPolicyFields({ value, onChange, onValidityChange, busy = false, authoringVersion, piMaxRequests, onPiMaxRequestsChange }: CodeVideoPolicyFieldsProps) {
  const [custom, setCustom] = useState(() => value !== undefined && !CODE_VIDEO_DURATION_PRESETS.some(seconds => seconds === value.targetDurationSeconds));
  const [durationText, setDurationText] = useState(() => String(value?.targetDurationSeconds ?? 60));
  const [durationInvalid, setDurationInvalid] = useState(false);
  const legacyRun = authoringVersion === 3;
  const disabled = busy || legacyRun;
  const update = (patch: Partial<CodeVideoPolicy>) => {
    if (!disabled) onChange({ ...(value ?? { ...newCodeVideoPolicy(), captionMode: codeVideoCaptionMode(value) }), ...patch });
  };
  return <section className="vox-production-fields" aria-label="代码影片策略">
    <strong>影片时长与字幕</strong>
    {legacyRun ? <p className="vox-hint" role="status">当前是旧版制作任务，不支持目标时长、影片字幕与旁白留白策略。这些设置已停用；请在新建代码影片时设置。</p> : null}
    {!value ? <p className="vox-hint">此项目尚未设置影片策略，沿用原有时长和宿主字幕。修改以下字段后才会保存策略。</p> : null}
    {authoringVersion !== 3 && onPiMaxRequestsChange ? <SelectField label="模型请求上限" value={String(piMaxRequests ?? 120)} disabled={busy}
      options={[32, 64, 120, 240, 500, 1000].map(count => ({ value: String(count), label: `${count} 次${count === 120 ? '（默认）' : ''}` }))}
      hint="v4 按模型请求总数限制；暂停后续跑可调整。每个运行段可能包含多次请求。"
      onChange={(_, event) => onPiMaxRequestsChange(Number(event.value) as NonNullable<VoxProductionSettings['piMaxRequests']>)} /> : null}
    <SelectField label="目标时长" value={custom ? 'custom' : value ? String(value.targetDurationSeconds) : ''} disabled={disabled}
      options={[...(!value ? [{ value: '', label: '沿用原有时长（未设置）' }] : []), ...CODE_VIDEO_DURATION_PRESETS.map(seconds => ({ value: String(seconds), label: `${seconds} 秒${seconds === 60 ? '（默认）' : ''}` })), { value: 'custom', label: '自定义（15–180 秒）' }]}
      hint="这是下一次制作的目标；实际成片时长以制作结果为准。"
      onChange={(_, event) => {
        if (event.value === 'custom') {
          setCustom(true);
          const parsed = codeVideoTargetDurationSchema.safeParse(durationText.trim() ? Number(durationText) : NaN);
          setDurationInvalid(!parsed.success); onValidityChange?.(parsed.success);
          if (parsed.success) update({ targetDurationSeconds: parsed.data });
          return;
        }
        if (!event.value) return;
        setCustom(false); setDurationText(event.value); setDurationInvalid(false); onValidityChange?.(true);
        update({ targetDurationSeconds: Number(event.value) });
      }} />
    {custom ? <TextField label="自定义目标时长（秒）" type="number" min={15} max={180} step={1} value={durationText} disabled={disabled}
      validationMessage={durationInvalid ? '请输入 15–180 之间的整数秒数；修正后才能保存或开始制作。' : undefined}
      onChange={(_, event) => {
        setDurationText(event.value);
        const parsed = codeVideoTargetDurationSchema.safeParse(event.value.trim() ? Number(event.value) : NaN);
        setDurationInvalid(!parsed.success); onValidityChange?.(parsed.success);
        if (parsed.success) update({ targetDurationSeconds: parsed.data });
      }} /> : null}
    <SelectField label="字幕方式" value={codeVideoCaptionMode(value)} disabled={disabled}
      options={[{ value: 'film', label: '影片字幕 · 随画面设计' }, { value: 'host', label: '宿主字幕 · 统一叠加' }]}
      hint="影片字幕由代码影片编排；宿主字幕由播放器与导出流程统一叠加。"
      onChange={(_, event) => update({ captionMode: event.value as CodeVideoPolicy['captionMode'] })} />
    <CheckboxField label="允许旁白留白" checked={value?.allowNarrationPauses ?? false} disabled={disabled}
      onChange={(_, event) => update({ allowNarrationPauses: event.checked === true })} />
    <SelectField label="长文处理" value={value?.longTextMode ?? 'split'} disabled={disabled}
      options={[{ value: 'split', label: '分段 · 保留内容' }, { value: 'condense', label: '精简 · 压缩文案' }]}
      hint="文案超过目标时长时，选择分段保留内容或精简表达。"
      onChange={(_, event) => update({ longTextMode: event.value as CodeVideoPolicy['longTextMode'] })} />
  </section>;
}

/** The run snapshot, never the pending settings, supplies the comparison target. */
export function CodeVideoDurationStatus({ policy, actualDurationSeconds }: { policy?: CodeVideoPolicy; actualDurationSeconds?: number }) {
  const actual = typeof actualDurationSeconds === 'number' && Number.isFinite(actualDurationSeconds) && actualDurationSeconds > 0
    ? `${Number(actualDurationSeconds.toFixed(2))} 秒` : '待生成';
  return <p className="vox-hint" role="status" data-code-video-duration="">本次制作 · 目标时长：{policy ? `${policy.targetDurationSeconds} 秒` : '未设置（沿用原有时长）'} · 实际时长：{actual}</p>;
}
