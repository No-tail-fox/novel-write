import { useEffect, useMemo } from "react";
import { Copy, Loader2, Palette, Play, Plus, Search, XCircle } from "lucide-react";
import type { AppConfig, ImageProviderProfile, ProviderModel, ProviderModelListRequest, TtsProviderProfile, VolcengineSpeaker } from "../../shared/types";
import { ArtifactEmpty } from "../tasks/TaskArtifactPreview";
import { activeImageProfileId, activeLlmProfileId, activeTtsProfileId, addImageProfile, addLlmProfile, addTtsProfile, copyImageProfile, copyLlmProfile, copyTtsProfile, editableLlmProfileProvider, imageProfileCustomImage, imageProfileGptImage, imageProfileJimeng, normalizedImageProfiles, normalizedTtsProfiles, removeImageProfile, removeLlmProfile, removeTtsProfile, saveImageProfile, saveLlmProfile, saveTtsProfile, ttsProfileMinimax, ttsProfileVolcengine } from "../../shared/provider-profile-utils";
import { defaultConfig } from "../../shared/config";
import { FormField as Field } from "../../components/FormField";
import { SegmentedControl as Segmented } from "../../components/SegmentedControl";
import {
  ConfigInput,
  ConfigNumberInput,
  ConfigTextarea,
  LocalInfo,
  ModelPicker,
  ProviderConfigNote,
  SecretInput,
  buildVolcengineVoiceOptions,
  imageProfileSummary,
  imageProviderLabel,
  profileSecretId,
  ttsProfileSummary,
  ttsProviderLabel,
  volcenginePresetVoiceValue,
  type ImageResolution,
  type ModelListKey,
  type SecretEditor,
} from './settings-controls';

export function LlmProfileManager({
  config,
  selectedProfileId,
  models,
  loadingModels,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  models: ProviderModel[];
  loadingModels: boolean;
  modelStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: () => void;
  onRefreshModels: (profile: AppConfig['llm']) => void;
}) {
  const profiles = config.llmProfiles.length ? config.llmProfiles : [config.llm];
  const activeId = activeLlmProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  function updateSelectedProfile(profile: AppConfig['llm']) {
    onChange(saveLlmProfile(config, profile));
  }

  function addProfile() {
    const next = addLlmProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.llmProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: AppConfig['llm']) {
    const next = copyLlmProfile(config, profile.id!);
    onChange(next);
    const currentIndex = config.llmProfiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.llmProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: AppConfig['llm']) {
    const next = removeLlmProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeLlmProfileId(next));
  }

  if (!selectedProfile) return <ArtifactEmpty text="暂无 LLM 配置档案" />;

  const selectedProvider = editableLlmProfileProvider(selectedProfile);
  const apiKeyId = profileSecretId('llm', selectedProfile.id, 'apiKey');
  const requestParamsJsonValue = selectedProfile.requestParamsJson ?? '{}';
  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>配置档案</strong>
          <span>可保存多个 OpenAI 兼容接口，启用一个作为任务运行配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'C'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名配置'}</strong>
                <span>{profile.baseUrl || 'https://api.openai.com'}</span>
                <small>{profile.model || '未选择模型'}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <ConfigNumberInput
          label="请求超时（秒）"
          value={Math.round((selectedProfile.timeoutMs ?? defaultConfig.llm.timeoutMs ?? 120000) / 1000)}
          min={10}
          step={10}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, timeoutMs: value * 1000 })}
        />
        <Segmented
          label="供应商"
          value={selectedProvider}
          options={['openai', 'custom', 'anthropic']}
          labels={['OpenAI', '自定义', 'Anthropic']}
          onChange={(value) => {
            onClearModels();
            updateSelectedProfile({
              ...selectedProfile,
              provider: value,
              protocol: value === 'anthropic' ? 'anthropic' : 'openai',
              baseUrl:
                value === 'openai'
                  ? 'https://api.openai.com'
                  : value === 'anthropic'
                    ? selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === defaultConfig.llm.baseUrl
                      ? 'https://api.anthropic.com'
                      : selectedProfile.baseUrl
                    : selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === 'https://api.anthropic.com'
                      ? defaultConfig.llm.baseUrl
                      : selectedProfile.baseUrl,
            });
          }}
        />
        {selectedProvider === 'openai' ? (
          <>
            <ProviderConfigNote title="OpenAI 对话接口" value="使用官方 /v1/chat/completions，填写接口密钥与模型。" />
            <SecretInput label="OpenAI 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="OpenAI 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        ) : selectedProvider === 'anthropic' ? (
          <>
            <ProviderConfigNote title="Anthropic Messages API" value="使用 /v1/messages，填写 Anthropic 接口密钥与 Claude 模型。" />
            <ConfigInput label="Anthropic 接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', baseUrl: value }); }} />
            <SecretInput label="Anthropic 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="Claude 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic' })}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"temperature":0,"max_tokens":4096}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', requestParamsJson: value })}
            />
          </>
        ) : (
          <>
            <ProviderConfigNote title="OpenAI 兼容 LLM" value="自定义接口按 /chat/completions 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, baseUrl: value }); }} />
            <SecretInput label="接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ImageProfileManager({
  config,
  selectedProfileId,
  gptModels,
  customModels,
  loadingModelList,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  gptModels: ProviderModel[];
  customModels: ProviderModel[];
  loadingModelList: ModelListKey | null;
  modelStatus: Partial<Record<ModelListKey, string>>;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: (key: ModelListKey) => void;
  onRefreshModels: (key: ModelListKey, request: ProviderModelListRequest, currentModel: string, applyModel?: (config: AppConfig, model: string) => AppConfig) => void;
}) {
  const profiles = normalizedImageProfiles(config);
  const activeId = activeImageProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  if (!selectedProfile) return <ArtifactEmpty text="暂无绘图配置档案" />;

  const provider = selectedProfile.provider;
  const gptImage = imageProfileGptImage(selectedProfile);
  const jimeng = imageProfileJimeng(selectedProfile);
  const customImage = imageProfileCustomImage(selectedProfile);
  const gptApiKeyId = profileSecretId('image', selectedProfile.id, 'gptImage/apiKey');
  const jimengSessionId = profileSecretId('image', selectedProfile.id, 'jimeng/sessionId');
  const jimengAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/accessKeyId');
  const jimengSecretAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/secretAccessKey');
  const customApiKeyId = profileSecretId('image', selectedProfile.id, 'customImage/apiKey');

  function updateSelectedProfile(profile: ImageProviderProfile) {
    onChange(saveImageProfile(config, profile));
  }

  function addProfile() {
    const next = addImageProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.imageProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: ImageProviderProfile) {
    const next = copyImageProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.imageProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: ImageProviderProfile) {
    const next = removeImageProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeImageProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>绘图档案</strong>
          <span>可保存 GPT Image、即梦和自定义图片接口，启用一个作为任务生图配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'I'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名绘图配置'}</strong>
                <span>{imageProviderLabel(profile.provider)}</span>
                <small>{imageProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="供应商"
          value={provider}
          options={['gpt_image', 'jimeng', 'custom']}
          labels={['GPT Image', '即梦', '自定义']}
          onChange={(value) => {
            onClearModels('gpt-image');
            onClearModels('custom-image');
            updateSelectedProfile({ ...selectedProfile, provider: value as ImageProviderProfile['provider'] });
          }}
        />
        {provider === 'gpt_image' ? (
          <>
            <ProviderConfigNote title="OpenAI 图像接口" value="接口密钥与模型必填；接口地址为空时使用官方默认端点。" />
            <ConfigInput label="GPT Image 接口地址（可选）" value={gptImage.baseUrl} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, baseUrl: value } }); }} />
            <SecretInput label="GPT Image 接口密钥" value={secrets.value(gptApiKeyId)} configured={secrets.configured(gptApiKeyId)} onChange={(value) => { onClearModels('gpt-image'); secrets.change(gptApiKeyId, value); }} onClear={() => secrets.change(gptApiKeyId, null)} />
            <ModelPicker
              key={`gpt-image-${selectedProfile.id}`}
              label="GPT Image 模型"
              value={gptImage.model}
              models={gptModels}
              loading={loadingModelList === 'gpt-image'}
              status={modelStatus['gpt-image']}
              onRefresh={() => onRefreshModels(
                'gpt-image',
                { baseUrl: gptImage.baseUrl || 'https://api.openai.com', apiKey: secrets.reference(gptApiKeyId).value, secretId: secrets.reference(gptApiKeyId).secretId },
                gptImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, gptImage: { ...gptImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, model: value } })}
            />
            <Segmented label="分辨率" value={gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={gptImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'jimeng' ? (
          <>
            <ProviderConfigNote title="火山视觉接口" value={`端点 ${jimeng.endpoint || 'https://visual.volcengineapi.com'} · 区域 ${jimeng.region || 'cn-north-1'} · 服务 ${jimeng.service || 'cv'}`} />
            <SecretInput label="即梦 Session ID" value={secrets.value(jimengSessionId)} configured={secrets.configured(jimengSessionId)} onChange={(value) => secrets.change(jimengSessionId, value)} onClear={() => secrets.change(jimengSessionId, null)} />
            <SecretInput label="即梦访问密钥 ID" value={secrets.value(jimengAccessKeyId)} configured={secrets.configured(jimengAccessKeyId)} onChange={(value) => secrets.change(jimengAccessKeyId, value)} onClear={() => secrets.change(jimengAccessKeyId, null)} />
            <SecretInput label="即梦访问密钥 Secret" value={secrets.value(jimengSecretAccessKeyId)} configured={secrets.configured(jimengSecretAccessKeyId)} onChange={(value) => secrets.change(jimengSecretAccessKeyId, value)} onClear={() => secrets.change(jimengSecretAccessKeyId, null)} />
            <ConfigInput label="即梦请求 Key" value={jimeng.reqKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, reqKey: value } })} />
            <Segmented label="分辨率" value={jimeng.resolution} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={jimeng.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'custom' ? (
          <>
            <ProviderConfigNote title="OpenAI 兼容接口" value="自定义图片接口按 /images/generations 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="自定义接口地址" value={customImage.baseUrl} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, baseUrl: value } }); }} />
            <SecretInput label="自定义接口密钥" value={secrets.value(customApiKeyId)} configured={secrets.configured(customApiKeyId)} onChange={(value) => { onClearModels('custom-image'); secrets.change(customApiKeyId, value); }} onClear={() => secrets.change(customApiKeyId, null)} />
            <ModelPicker
              key={`custom-image-${selectedProfile.id}`}
              label="自定义模型"
              value={customImage.model}
              models={customModels}
              loading={loadingModelList === 'custom-image'}
              status={modelStatus['custom-image']}
              onRefresh={() => onRefreshModels(
                'custom-image',
                { baseUrl: customImage.baseUrl, apiKey: secrets.reference(customApiKeyId).value, secretId: secrets.reference(customApiKeyId).secretId },
                customImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, customImage: { ...customImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, model: value } })}
            />
            <Segmented label="分辨率" value={customImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={customImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function TtsProfileManager({
  config,
  selectedProfileId,
  cloneVoiceCount,
  volcengineSpeakers,
  loadingVolcengineSpeakers,
  volcengineSpeakerStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onRefreshVolcengineSpeakers,
}: {
  config: AppConfig;
  selectedProfileId: string;
  cloneVoiceCount: number;
  volcengineSpeakers: VolcengineSpeaker[];
  loadingVolcengineSpeakers: boolean;
  volcengineSpeakerStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onRefreshVolcengineSpeakers: (profile: TtsProviderProfile) => void;
}) {
  const profiles = normalizedTtsProfiles(config);
  const activeId = activeTtsProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  const availableVolcengineVoices = useMemo(() => buildVolcengineVoiceOptions(volcengineSpeakers), [volcengineSpeakers]);
  if (!selectedProfile) return <ArtifactEmpty text="暂无 TTS 配置档案" />;

  const provider = selectedProfile.provider;
  const volcengine = ttsProfileVolcengine(selectedProfile);
  const minimax = ttsProfileMinimax(selectedProfile);
  const voiceSelection = volcenginePresetVoiceValue(volcengine.speaker, availableVolcengineVoices);
  const volcengineApiKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/apiKey');
  const volcengineAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/accessKeyId');
  const volcengineSecretAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/secretAccessKey');
  const minimaxApiKeyId = profileSecretId('tts', selectedProfile.id, 'minimax/apiKey');

  function updateSelectedProfile(profile: TtsProviderProfile) {
    onChange(saveTtsProfile(config, profile));
  }

  function updateVolcengineVoice(voiceType: string) {
    updateSelectedProfile({ ...selectedProfile, speaker: voiceType, volcengine: { ...volcengine, speaker: voiceType } });
  }

  function addProfile() {
    const next = addTtsProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.ttsProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: TtsProviderProfile) {
    const next = copyTtsProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.ttsProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: TtsProviderProfile) {
    const next = removeTtsProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeTtsProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>TTS 档案</strong>
          <span>可保存火山引擎与 MiniMax 配音配置，启用一个作为任务配音配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'T'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名 TTS 配置'}</strong>
                <span>{ttsProviderLabel(profile.provider)}</span>
                <small>{ttsProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="引擎"
          value={provider}
          options={['volcengine', 'minimax']}
          labels={['火山引擎', 'MiniMax']}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: value as TtsProviderProfile['provider'] })}
        />
        {provider === 'volcengine' ? (
          <>
            <ProviderConfigNote title="火山引擎 TTS" value="V3 HTTP Chunked 使用新版控制台 TTS 接口密钥；资源与端点使用系统默认配置。" />
            <SecretInput label="火山 TTS 接口密钥" value={secrets.value(volcengineApiKeyId)} configured={secrets.configured(volcengineApiKeyId)} onChange={(value) => secrets.change(volcengineApiKeyId, value)} onClear={() => secrets.change(volcengineApiKeyId, null)} />
            <SecretInput label="音色访问密钥 ID" value={secrets.value(volcengineAccessKeyId)} configured={secrets.configured(volcengineAccessKeyId)} onChange={(value) => secrets.change(volcengineAccessKeyId, value)} onClear={() => secrets.change(volcengineAccessKeyId, null)} />
            <SecretInput label="音色访问密钥 Secret" value={secrets.value(volcengineSecretAccessKeyId)} configured={secrets.configured(volcengineSecretAccessKeyId)} onChange={(value) => secrets.change(volcengineSecretAccessKeyId, value)} onClear={() => secrets.change(volcengineSecretAccessKeyId, null)} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" disabled={loadingVolcengineSpeakers} onClick={() => onRefreshVolcengineSpeakers(selectedProfile)}>
                {loadingVolcengineSpeakers ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                加载音色
              </button>
              {volcengineSpeakerStatus ? <span>{volcengineSpeakerStatus}</span> : null}
            </div>
            <Field label="默认音色">
              <div className="model-picker">
                <select value={voiceSelection} onChange={(event) => updateVolcengineVoice(event.target.value === 'custom' ? '' : event.target.value)}>
                  <option value="custom">自定义 voice_type</option>
                  {availableVolcengineVoices.map((voice) => (
                    <option key={voice.voiceType} value={voice.voiceType}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {voiceSelection === 'custom' ? (
              <ConfigInput label="自定义 voice_type" value={volcengine.speaker} onChange={updateVolcengineVoice} />
            ) : null}
          </>
        ) : null}
        {provider === 'minimax' ? (
          <>
            <ProviderConfigNote title="MiniMax TTS" value="填写接口密钥、模型和音色 ID。" />
            <SecretInput label="MiniMax 接口密钥" value={secrets.value(minimaxApiKeyId)} configured={secrets.configured(minimaxApiKeyId)} onChange={(value) => secrets.change(minimaxApiKeyId, value)} onClear={() => secrets.change(minimaxApiKeyId, null)} />
            <ConfigInput label="MiniMax 模型" value={minimax.model} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, model: value } })} />
            <ConfigInput label="MiniMax 音色 ID" value={minimax.voiceId} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, voiceId: value } })} />
            <LocalInfo title="克隆音色" value={`${cloneVoiceCount} 个本地记录，可后续接入 MiniMax 克隆接口。`} />
          </>
        ) : null}
      </div>
    </div>
  );
}
