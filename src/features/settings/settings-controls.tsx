import React, { useState } from "react";
import { Eye, EyeOff, Info, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { AppConfig, AppMutationResult, ImageProviderProfile, ProviderModel, TtsProviderProfile, VolcengineSpeaker } from "../../shared/types";
import type { SecretId } from "../../shared/config-secrets";
import { imageProfileCustomImage, imageProfileGptImage, imageProfileJimeng, normalizeEditableConfigProviders, saveLlmProfile, ttsProfileMinimax, ttsProfileVolcengine } from "../../shared/provider-profile-utils";
import { volcengineVoicePresets } from '../../shared/editorial-options';

export type ModelListKey = 'llm' | 'gpt-image' | 'custom-image';

export type SecretEditor = {
  value: (id: SecretId) => string;
  configured: (id: SecretId) => boolean;
  reference: (id: SecretId) => { value: string; secretId?: string };
  change: (id: SecretId, value: string | null) => void;
};

export function profileSecretId(domain: 'llm' | 'image' | 'tts', profileId: string | undefined, suffix: string): SecretId {
  const stableId = profileId?.trim();
  if (!stableId) throw new Error('Provider profile requires a stable id.');
  return `${domain}/${encodeURIComponent(stableId)}/${suffix}` as SecretId;
}

export function configFromMutation(result: AppMutationResult | null): AppConfig {
  if (result?.kind === 'state-patch' && result.patch.kind === 'config') return result.patch.config;
  throw new Error('CONFIG_MUTATION_INVALID: Save did not return a config patch.');
}

export type ImageResolution = '1K' | '2K' | '4K';

export type VolcengineVoiceOption = {
  voiceType: string;
  label: string;
};

export function mergeVolcengineSpeakers(current: VolcengineSpeaker[], incoming: VolcengineSpeaker[]): VolcengineSpeaker[] {
  const byVoiceType = new Map(current.map((speaker) => [speaker.voiceType, speaker]));
  incoming.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (voiceType) byVoiceType.set(voiceType, { ...speaker, voiceType });
  });
  return [...byVoiceType.values()];
}

export function buildVolcengineVoiceOptions(speakers: VolcengineSpeaker[]): VolcengineVoiceOption[] {
  const byVoiceType = new Map<string, VolcengineVoiceOption>();
  volcengineVoicePresets.forEach(([label, voiceType]) => {
    byVoiceType.set(voiceType, { voiceType, label });
  });
  speakers.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (!voiceType) return;
    byVoiceType.set(voiceType, {
      voiceType,
      label: speaker.name.trim() || volcengineStaticPresetLabel(voiceType) || voiceType,
    });
  });
  return [...byVoiceType.values()];
}

export function volcenginePresetVoiceValue(speaker: string, options: VolcengineVoiceOption[] = buildVolcengineVoiceOptions([])): string {
  return options.some((option) => option.voiceType === speaker) ? speaker : 'custom';
}

export function volcengineVoicePresetLabel(speaker: string, speakers: VolcengineSpeaker[] = []): string {
  return buildVolcengineVoiceOptions(speakers).find((option) => option.voiceType === speaker)?.label ?? '';
}

export function volcengineStaticPresetLabel(speaker: string): string {
  return volcengineVoicePresets.find(([, voiceType]) => voiceType === speaker)?.[0] ?? '';
}

export function setDraftModel(config: AppConfig, key: ModelListKey, model: string): AppConfig {
  if (key === 'gpt-image') {
    return { ...config, gptImage: { ...config.gptImage, model } };
  }
  if (key === 'custom-image') {
    return { ...config, customImage: { ...config.customImage, model } };
  }
  return saveLlmProfile(config, { ...config.llm, model });
}

export function setImageResolution(config: AppConfig, resolution: ImageResolution): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, resolution } };
  }
  return { ...config, image: { ...config.image, resolution }, gptImage: { ...config.gptImage, resolution } };
}

export function activeImageResolution(config: AppConfig): ImageResolution {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

export function setImageConcurrency(config: AppConfig, concurrency: number): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, concurrency } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, concurrency } };
  }
  return { ...config, image: { ...config.image, concurrency }, gptImage: { ...config.gptImage, concurrency } };
}

export function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

export function SettingsCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="config-card">
      <div className="config-card-head"><div><strong>{title}</strong><span>使用中</span></div><small>{status}</small></div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

export function ConfigInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="config-input"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function SecretInput({
  label,
  value,
  configured,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  configured: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="config-input secret-input">
      <span>{label}<small>{configured ? '已配置' : '待配置'}</small></span>
      <div className="secret-input-control">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="icon-button" type="button" title={revealed ? '隐藏' : '显示'} aria-label={revealed ? '隐藏密钥' : '显示密钥'} onClick={() => setRevealed((current) => !current)}>
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button className="icon-button" type="button" title="清除" aria-label="清除密钥" disabled={!configured && !value} onClick={onClear}>
          <Trash2 size={15} />
        </button>
      </div>
    </label>
  );
}

export function ConfigTextarea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="config-input config-textarea">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function ConfigNumberInput({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="config-input">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function ModelPicker({
  label,
  value,
  models,
  loading,
  status,
  onRefresh,
  onChange,
}: {
  label: string;
  value: string;
  models: ProviderModel[];
  loading: boolean;
  status?: string;
  onRefresh: () => void;
  onChange: (value: string) => void;
}) {
  const hasModels = models.length > 0;
  const options = hasModels && value && !models.some((model) => model.id === value) ? [{ id: value }, ...models] : models;
  return (
    <div className="field model-picker-field">
      <span>{label}</span>
      <div className="model-picker">
        {hasModels ? (
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            {!value ? <option value="">选择模型</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button className="icon-button model-refresh-button" title="获取模型" aria-label="获取模型" disabled={loading} onClick={onRefresh} type="button">
          {loading ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
      {status ? <small className="model-list-status">{status}</small> : null}
    </div>
  );
}

export function LocalInfo({ title, value }: { title: string; value: string }) {
  return <div className="local-info"><Info size={18} /><div><strong>{title}</strong><span>{value}</span></div></div>;
}

export function ProviderConfigNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="provider-config-note">
      <Info size={16} />
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

export function settingsStatusLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '已配置' : status === 'warn' ? '需确认' : '待配置';
}

export function settingsConfigSignature(config: AppConfig): string {
  return JSON.stringify(normalizeEditableConfigProviders(config));
}

export function imageProviderLabel(provider: ImageProviderProfile['provider']): string {
  return provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : '自定义图片';
}

export function imageProfileSummary(profile: ImageProviderProfile): string {
  if (profile.provider === 'jimeng') return imageProfileJimeng(profile).reqKey || imageProfileJimeng(profile).model || '未配置 Req Key';
  if (profile.provider === 'custom') return imageProfileCustomImage(profile).model || '未选择模型';
  return imageProfileGptImage(profile).model || '未选择模型';
}

export function ttsProviderLabel(provider: TtsProviderProfile['provider']): string {
  return provider === 'minimax' ? 'MiniMax' : '火山引擎';
}

export function ttsProfileSummary(profile: TtsProviderProfile): string {
  if (profile.provider === 'minimax') return ttsProfileMinimax(profile).model || '未选择模型';
  const speaker = ttsProfileVolcengine(profile).speaker;
  return volcengineVoicePresetLabel(speaker) || speaker || '未选择音色';
}
