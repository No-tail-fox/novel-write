import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, Copy, Database, Film, FlaskConical, FolderOpen, Globe2, Image as ImageIcon, Info, KeyRound, Loader2, Mic2, Palette, Save, Search, Sparkles, Upload, Wand2, XCircle } from "lucide-react";
import { useMemo } from "react";
import type { AppConfig, ConfigTestTarget, ImaKnowledgeResult, ProviderModel, ProviderModelListRequest, ShellView, ThemeName, TtsProviderProfile, VolcengineSpeaker } from "../../shared/types";
import type { StoryDreamApi } from "../../shared/storydream-api";
import type { JianyingDraftPathDetection } from "../../shared/jianying-paths";
import { addUploadedBgm, resolveDefaultBgmId, validBgmItems } from "../tasks/task-formatters";
import type { SecretChanges, SecretId } from "../../shared/config-secrets";
import { changeRuntimeTheme, type RuntimeThemeStateSynchronizer } from "./theme-controller";
import { configTargetStatus } from "../../shared/config-utils";
import { activeImageProfileId, activeLlmProfileId, activeTtsProfileId, activateSelectedProviderProfileForTarget, buildConfigForSelectedProfileTest, enableImageProfile, enableLlmProfile, enableTtsProfile, normalizeEditableConfigProviders, ttsProfileVolcengine } from "../../shared/provider-profile-utils";
import { useAsyncAction } from "../../ui/async-action";
import { FormField as Field } from "../../components/FormField";
import { SegmentedControl as Segmented } from "../../components/SegmentedControl";
import { ToggleField } from "../../components/ToggleField";
import { Button, SwitchField } from '../../ui';
import { RangeField } from "../../components/RangeField";
import { AsyncActionFeedback as InlineActionFeedback } from "../../components/AsyncActionFeedback";
import type { ApplyMutationResult, RendererAppState as AppState } from "../../app/route-types";
import { siliconFlowSpeechToTextBaseUrl, siliconFlowSpeechToTextModels } from "../../shared/editorial-options";
import { ImageProfileManager, LlmProfileManager, TtsProfileManager } from './ProviderProfileManagers';
import { MinimaxCloneVoiceManager } from './MinimaxCloneVoiceManager';
import {
  ConfigInput,
  ConfigNumberInput,
  LocalInfo,
  ProviderConfigNote,
  SecretInput,
  SettingsCard,
  configFromMutation,
  configWithCredentialStatus,
  hasPendingLlmSecretChange,
  mergeVolcengineSpeakers,
  profileSecretId,
  setDraftModel,
  settingsConfigSignature,
  settingsStatusLabel,
  type ModelListKey,
  type SecretEditor,
} from './settings-controls';

export type SettingsSection = 'appearance' | 'llm' | 'image' | 'video' | 'tts' | 'speechToText' | 'jianying' | 'activation' | 'creative' | 'webSearch' | 'about';

export function SettingsPage({ api, state, applyState, synchronizeThemeState, navigate, initialSection, returnView, onReturn }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult; synchronizeThemeState: RuntimeThemeStateSynchronizer; navigate: (view: ShellView) => void; initialSection?: SettingsSection; returnView?: ShellView; onReturn?: () => void }) {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'llm');
  const [draft, setDraft] = useState<AppConfig>(() => normalizeEditableConfigProviders(state.config));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [secretChanges, setSecretChanges] = useState<SecretChanges>({});
  const [lastAppliedConfigSignature, setLastAppliedConfigSignature] = useState(() => settingsConfigSignature(state.config));
  const [diagnostics, setDiagnostics] = useState('');
  const [configTestResult, setConfigTestResult] = useState('');
  const [jianyingDetection, setJianyingDetection] = useState<JianyingDraftPathDetection | null>(null);
  const [imaKnowledgeResult, setImaKnowledgeResult] = useState<ImaKnowledgeResult | null>(null);
  const [testingConfig, setTestingConfig] = useState(false);
  const [modelLists, setModelLists] = useState<Record<ModelListKey, ProviderModel[]>>({ llm: [], 'gpt-image': [], 'custom-image': [] });
  const [modelListStatus, setModelListStatus] = useState<Partial<Record<ModelListKey, string>>>({});
  const [loadingModelList, setLoadingModelList] = useState<ModelListKey | null>(null);
  const [volcengineSpeakers, setVolcengineSpeakers] = useState<VolcengineSpeaker[]>([]);
  const [volcengineSpeakerStatus, setVolcengineSpeakerStatus] = useState('');
  const [loadingVolcengineSpeakers, setLoadingVolcengineSpeakers] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedLlmProfileId, setSelectedLlmProfileId] = useState(() => activeLlmProfileId(state.config));
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(() => activeImageProfileId(state.config));
  const [selectedTtsProfileId, setSelectedTtsProfileId] = useState(() => activeTtsProfileId(state.config));
  const [minimaxCloneVoiceCatalog, setMinimaxCloneVoiceCatalog] = useState(() => state.minimaxCloneVoices);
  const saveAction = useAsyncAction();
  const settingsAction = useAsyncAction();
  const themeAction = useAsyncAction();
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);
  useEffect(() => {
    if (settingsDirty) return;
    const nextSignature = settingsConfigSignature(state.config);
    if (nextSignature === lastAppliedConfigSignature) return;
    setDraft(normalizeEditableConfigProviders(state.config));
    setSecretChanges({});
    setLastAppliedConfigSignature(nextSignature);
  }, [lastAppliedConfigSignature, settingsDirty, state.config]);
  useEffect(() => {
    setMinimaxCloneVoiceCatalog(state.minimaxCloneVoices);
  }, [state.minimaxCloneVoices]);
  function setSettingsDraft(next: AppConfig | ((current: AppConfig) => AppConfig)) {
    setSettingsDirty(true);
    setDraft(next);
  }
  function commitSettingsDraft(next: AppConfig) {
    const normalized = normalizeEditableConfigProviders(next);
    setDraft(normalized);
    setSettingsDirty(false);
    setSecretChanges({});
    setLastAppliedConfigSignature(settingsConfigSignature(normalized));
  }
  const persistSettingsDraft = async (nextDraft: AppConfig, successMessage: string) => {
    setSavingConfig(true);
    try {
      const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
      const savedConfig = configFromMutation(next);
      commitSettingsDraft(savedConfig);
      applyState(next);
      setConfigTestResult(`[pass] ${successMessage}`);
      return savedConfig;
    } finally {
      setSavingConfig(false);
    }
  };
  async function commitAndApplySettingsDraft(nextDraft: AppConfig, successMessage = '配置已保存') {
    const result = await saveAction.run(
      () => persistSettingsDraft(nextDraft, successMessage),
      { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) },
    );
    if (!result.ok && result.reason === 'busy') {
      setConfigTestResult('[warn] 配置正在保存，请稍候。');
    }
    return result.ok ? result.value : undefined;
  }
  function clearProviderModels(key: ModelListKey) {
    setModelLists((current) => ({ ...current, [key]: [] }));
    setModelListStatus((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  function changeSecret(id: SecretId, value: string | null) {
    setSettingsDirty(true);
    setSecretChanges((current) => {
      const next = { ...current };
      if (value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function secretValue(id: SecretId): string {
    const value = secretChanges[id];
    return typeof value === 'string' ? value : '';
  }
  function isSecretConfigured(id: SecretId): boolean {
    const value = secretChanges[id];
    if (value === null) return false;
    if (typeof value === 'string') return value.length > 0;
    return state.secretStatus[id] === true;
  }
  function secretReference(id: SecretId): { value: string; secretId?: string } {
    if (secretChanges[id] === null) return { value: '' };
    return { value: secretValue(id), secretId: id };
  }
  const secrets: SecretEditor = {
    value: secretValue,
    configured: isSecretConfigured,
    reference: secretReference,
    change: changeSecret,
  };
  async function save() {
    await commitAndApplySettingsDraft(activateSelectedProviderProfileForTarget(draft, section as ConfigTestTarget, {
      llm: selectedLlmProfileId,
      image: selectedImageProfileId,
      tts: selectedTtsProfileId,
    }));
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '已启用 LLM 配置档案');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '已启用绘图配置档案');
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '已启用 TTS 配置档案');
  }
  async function testCurrentConfig() {
    const target: ConfigTestTarget =
      section === 'llm' || section === 'image' || section === 'video' || section === 'tts' || section === 'speechToText' || section === 'jianying' || section === 'creative' || section === 'webSearch'
        ? section
        : 'llm';
    await settingsAction.run(async () => {
      setTestingConfig(true);
      setSavingConfig(true);
      setConfigTestResult('正在保存并测试当前配置...');
      try {
        const nextDraft = activateSelectedProviderProfileForTarget(draft, target, {
          llm: selectedLlmProfileId,
          image: selectedImageProfileId,
          tts: selectedTtsProfileId,
        });
        const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
        const savedConfig = configFromMutation(next);
        commitSettingsDraft(savedConfig);
        applyState(next);
        const testConfig = buildConfigForSelectedProfileTest(savedConfig, target, selectedProviderProfileIds);
        const result = await api.testAppConfig(target, testConfig);
        setConfigTestResult(`[${result.status}] ${result.detail}`);
      } finally {
        setSavingConfig(false);
        setTestingConfig(false);
      }
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function testSelectedLlmConfig() {
    if (selectedLlmTestBlocked) {
      setConfigTestResult(selectedLlmSecretPending
        ? '[warn] 当前 LLM 密钥有未保存变更，请先保存配置或使用“保存并测试”。'
        : '[warn] 当前 LLM 配置档案尚未保存，请先保存配置或使用“保存并测试”。');
      return;
    }
    await settingsAction.run(async () => {
      setTestingConfig(true);
      setConfigTestResult('正在测试当前 LLM...');
      try {
        const result = await api.testLlmConfig(selectedLlmTestConfig.llm);
        setConfigTestResult(`[${result.status}] ${result.detail}`);
      } finally {
        setTestingConfig(false);
      }
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function refreshProviderModels(
    key: ModelListKey,
    request: ProviderModelListRequest,
    currentModel: string,
    applyModel?: (config: AppConfig, model: string) => AppConfig,
  ) {
    if (key === 'custom-image' && !request.baseUrl.trim()) {
      setModelListStatus((current) => ({ ...current, [key]: '[失败] 拉取模型前需要填写接口地址。' }));
      return;
    }
    await settingsAction.run(async () => {
      setLoadingModelList(key);
      setModelListStatus((current) => ({ ...current, [key]: '正在获取模型清单...' }));
      try {
        const result = await api.listProviderModels(request);
        setModelListStatus((current) => ({ ...current, [key]: `[${result.status}] ${result.detail}` }));
        if (result.models.length) {
          setModelLists((current) => ({ ...current, [key]: result.models }));
          if (!currentModel.trim()) {
            setSettingsDraft((current) => (applyModel ? applyModel(current, result.models[0].id) : setDraftModel(current, key, result.models[0].id)));
          }
        }
      } finally {
        setLoadingModelList((current) => (current === key ? null : current));
      }
    }, { onError: (error) => setModelListStatus((current) => ({ ...current, [key]: `[fail] ${error.message}` })) });
  }
  async function refreshVolcengineSpeakers(profile: TtsProviderProfile) {
    const volcengine = ttsProfileVolcengine(profile);
    const accessKeyIdId = profileSecretId('tts', profile.id, 'volcengine/accessKeyId');
    const secretAccessKeyId = profileSecretId('tts', profile.id, 'volcengine/secretAccessKey');
    const accessKeyId = secrets.reference(accessKeyIdId);
    const secretAccessKey = secrets.reference(secretAccessKeyId);
    if (!secrets.configured(accessKeyIdId) || !secrets.configured(secretAccessKeyId)) {
      setVolcengineSpeakerStatus('[失败] 加载火山音色列表需要填写访问密钥 ID 和访问密钥 Secret。');
      return;
    }

    const resourceId = (volcengine.resourceId ?? '').trim() || 'seed-tts-2.0';
    const limit = 100;
    await settingsAction.run(async () => {
      setLoadingVolcengineSpeakers(true);
      setVolcengineSpeakerStatus('正在加载全部音色...');
      try {
        const request = {
          accessKeyId: accessKeyId.value,
          secretAccessKey: secretAccessKey.value,
          accessKeyIdSecretId: accessKeyId.secretId,
          secretAccessKeySecretId: secretAccessKey.secretId,
          resourceId,
          limit,
        };
        const first = await api.listVolcengineSpeakers({ ...request, page: 1 });
        let speakers = mergeVolcengineSpeakers([], first.speakers);
        const total = first.total || speakers.length;
        if (first.status !== 'fail' && total > speakers.length) {
          const pageCount = Math.min(Math.ceil(total / limit), 20);
          for (let page = 2; page <= pageCount; page += 1) {
            const next = await api.listVolcengineSpeakers({ ...request, page });
            if (next.status === 'fail' || !next.speakers.length) break;
            speakers = mergeVolcengineSpeakers(speakers, next.speakers);
            if (speakers.length >= total) break;
          }
        }
        setVolcengineSpeakers(speakers);
        const loadedText = speakers.length > first.speakers.length ? `，已合并 ${speakers.length}/${total} 个` : '';
        setVolcengineSpeakerStatus(`[${first.status}] ${first.detail}${loadedText}`);
      } finally {
        setLoadingVolcengineSpeakers(false);
      }
    }, { onError: (error) => setVolcengineSpeakerStatus(`[fail] ${error.message}`) });
  }
  async function runDiagnostics() {
    await settingsAction.run(async () => {
      const report = await api.runDiagnostics();
      setDiagnostics(JSON.stringify(report, null, 2));
    });
  }
  async function fetchImaKnowledgeFromSettings() {
    await settingsAction.run(async () => {
      const savedConfig = await persistSettingsDraft(draft, 'IMA 配置已保存');
      const result = await api.fetchImaKnowledge({ query: savedConfig.ima.kbName || savedConfig.ima.kbId });
      setImaKnowledgeResult(result);
      setConfigTestResult(`[${result.status}] ${result.detail}`);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function uploadBgmFromSettings() {
    await settingsAction.run(async () => {
      const imported = await api.importBgmAudio();
      if (!imported) return;
      const nextBgm = addUploadedBgm(draft, imported);
      await persistSettingsDraft(nextBgm.config, '已添加 BGM 文件');
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function autoDetectJianyingDraftPath() {
    await settingsAction.run(async () => {
      setConfigTestResult('正在自动检测剪映草稿目录...');
      const detection = await api.detectJianyingDraftPath();
      setJianyingDetection(detection);
      if (detection.status !== 'pass' || !detection.path) {
        setConfigTestResult(`[warn] ${detection.detail}`);
        return;
      }
      setSettingsDraft((current) => ({ ...current, jianying: { ...current.jianying, draftPath: detection.path } }));
      setConfigTestResult(`[pass] ${detection.detail} 已填入检测结果，保存配置后生效。`);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function pickJianyingDraftPath() {
    await settingsAction.run(async () => {
      const folder = await api.selectLocalFolder();
      if (!folder) return;
      setJianyingDetection(null);
      setSettingsDraft((current) => ({ ...current, jianying: { ...current.jianying, draftPath: folder } }));
      setConfigTestResult(`已选择剪映草稿目录：${folder}`);
    });
  }
  function setDefaultBgm(id: string) {
    setSettingsDraft({ ...draft, jianying: { ...draft.jianying, defaultBgmId: id } });
  }
  function updateBgmVolume(id: string, volume: number) {
    setSettingsDraft({
      ...draft,
      jianying: {
        ...draft.jianying,
        bgmLibrary: draft.jianying.bgmLibrary.map((bgm) => (bgm.id === id ? { ...bgm, volume } : bgm)),
      },
    });
  }
  function removeBgm(id: string) {
    const bgmLibrary = draft.jianying.bgmLibrary.filter((bgm) => bgm.id !== id);
    const nextConfig = { ...draft, jianying: { ...draft.jianying, bgmLibrary, defaultBgmId: draft.jianying.defaultBgmId === id ? '' : draft.jianying.defaultBgmId } };
    setSettingsDraft({ ...nextConfig, jianying: { ...nextConfig.jianying, defaultBgmId: resolveDefaultBgmId(nextConfig) } });
  }
  function updateSpeechToTextConfig(patch: Partial<AppConfig['speechToText']>) {
    setSettingsDraft({ ...draft, speechToText: { ...draft.speechToText, ...patch } });
  }
  function updateActiveVideoProvider(patch: Partial<AppConfig['video']['providers'][number]>) {
    setSettingsDraft((current) => ({
      ...current,
      video: {
        ...current.video,
        providers: current.video.providers.map((provider) => provider.id === current.video.activeProviderId ? { ...provider, ...patch } : provider),
      },
    }));
  }
  function updateVideoAutomation(patch: Partial<AppConfig['video']['automation']>) {
    setSettingsDraft((current) => ({ ...current, video: { ...current.video, automation: { ...current.video.automation, ...patch } } }));
  }
  function switchSpeechToTextProvider(provider: AppConfig['speechToText']['provider']) {
    if (provider === 'siliconflow') {
      updateSpeechToTextConfig({
        provider,
        baseUrl: siliconFlowSpeechToTextBaseUrl,
        model: siliconFlowSpeechToTextModels[0],
        responseFormat: 'json',
        timestampGranularities: ['segment'],
        chunkingStrategy: 'none',
      });
      return;
    }
    updateSpeechToTextConfig({
      provider,
      baseUrl: draft.speechToText.baseUrl.includes('siliconflow') ? 'https://api.openai.com/v1' : draft.speechToText.baseUrl,
      model: siliconFlowSpeechToTextModels.includes(draft.speechToText.model) ? 'whisper-1' : draft.speechToText.model,
    });
  }
  function toggleSpeechToTextTimestamp(granularity: AppConfig['speechToText']['timestampGranularities'][number], checked: boolean) {
    const current = draft.speechToText.timestampGranularities.filter((item) => item !== granularity);
    updateSpeechToTextConfig({ timestampGranularities: checked ? [...current, granularity] : current });
  }
  async function selectTheme(nextTheme: AppState['ui']['theme']) {
    await themeAction.run(async () => {
      const changed = await changeRuntimeTheme({
        currentTheme: state.ui.theme,
        nextTheme,
        synchronizeState: synchronizeThemeState,
        persist: () => api.saveUiPreferences({ theme: nextTheme }),
      });
      applyState(changed.mutation);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  const selectedProviderProfileIds = {
    llm: selectedLlmProfileId,
    image: selectedImageProfileId,
    tts: selectedTtsProfileId,
  };
  const draftWithCredentialStatus = useMemo(
    () => configWithCredentialStatus(draft, state.secretStatus, secretChanges),
    [draft, secretChanges, state.secretStatus],
  );
  const selectedLlmTestConfig = buildConfigForSelectedProfileTest(draftWithCredentialStatus, 'llm', selectedProviderProfileIds);
  const selectedLlmSecretPending = hasPendingLlmSecretChange(secretChanges, selectedLlmTestConfig.llm.id);
  const selectedLlmProfilePersisted = state.config.llmProfiles.some((profile) => profile.id === selectedLlmTestConfig.llm.id)
    || state.config.llm.id === selectedLlmTestConfig.llm.id;
  const selectedLlmTestBlocked = selectedLlmSecretPending || !selectedLlmProfilePersisted;
  const selectedImageTestConfig = buildConfigForSelectedProfileTest(draftWithCredentialStatus, 'image', selectedProviderProfileIds);
  const selectedTtsTestConfig = buildConfigForSelectedProfileTest(draftWithCredentialStatus, 'tts', selectedProviderProfileIds);
  const activeVideoProvider = draft.video.providers.find((provider) => provider.id === draft.video.activeProviderId) ?? draft.video.providers[0];
  const activeVideoSecretId = profileSecretId('video', activeVideoProvider.id, 'apiKey');
  const settingsBgms = validBgmItems(draft);
  const isSiliconFlowSpeechToText = draft.speechToText.provider === 'siliconflow';
  const sections = [
    ['appearance', Palette, '外观', '明暗主题', state.ui.theme === 'dark' ? '深色' : '浅色'],
    ['llm', Sparkles, 'LLM', '文案与分镜', settingsStatusLabel(configTargetStatus('llm', draftWithCredentialStatus))],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', settingsStatusLabel(configTargetStatus('image', draftWithCredentialStatus))],
    ['video', Film, 'AI 视频', '云端生成 · 调度', settingsStatusLabel(configTargetStatus('video', draftWithCredentialStatus))],
    ['tts', Bot, 'TTS 配音', '每镜语音', settingsStatusLabel(configTargetStatus('tts', draftWithCredentialStatus))],
    ['speechToText', Mic2, '语音转文字', '爆款拆解转写 API', settingsStatusLabel(configTargetStatus('speechToText', draftWithCredentialStatus))],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', settingsStatusLabel(configTargetStatus('jianying', draftWithCredentialStatus))],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', settingsStatusLabel(configTargetStatus('creative', draftWithCredentialStatus))],
    ['webSearch', Globe2, '联网搜索', 'SearXNG · Tavily · 兼容源', settingsStatusLabel(configTargetStatus('webSearch', draftWithCredentialStatus))],
    ['about', Info, '关于 · 诊断', '日志 · 重置', '已配置'],
  ] as const;
  const returnLabel = returnView === 'editorial-collage' ? '返回 VOX 视频' : returnView === 'motion-comic' ? '返回 AI 漫剧' : '返回创作首页';
  return (
    <div className="settings-layout">
      <section className="settings-menu">
        {onReturn ? <Button className="settings-return-action" variant="subtle" icon={<ArrowLeft size={14} />} onClick={onReturn}>{returnLabel}</Button> : null}
        {sections.map(([id, Icon, label, hint, status]) => (
          <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>
            <Icon size={16} />
            <strong>{label}</strong>
            <span>{hint}</span>
            <small>{status}</small>
          </button>
        ))}
      </section>
      <section className="settings-content panel">
        <div className="panel-title-row">
          <div className="settings-heading">
            <div className="square-icon"><Sparkles size={18} /></div>
            <div><h2>{sections.find(([id]) => id === section)?.[2]}</h2><span>配置 API 凭证与本地路径</span></div>
          </div>
          <div className="button-row">
            {section === 'llm' ? (
              <button className="ghost-action" type="button" title={selectedLlmTestBlocked ? '请先保存当前 LLM 配置档案或密钥变更' : '仅测试当前 LLM'} disabled={testingConfig || savingConfig || settingsAction.busy || selectedLlmTestBlocked} onClick={testSelectedLlmConfig}>
                {testingConfig ? <Loader2 className="spin" size={15} /> : <FlaskConical size={15} />}
                仅测试当前 LLM
              </button>
            ) : null}
            <button className="ghost-action" disabled={testingConfig || savingConfig} onClick={testCurrentConfig}>
              {testingConfig ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              保存并测试
            </button>
            <button className="primary-action slim" disabled={savingConfig || saveAction.busy} onClick={save}>
              {savingConfig ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存配置
            </button>
          </div>
        </div>
        {configTestResult ? <div className="test-result">{configTestResult}</div> : null}
        {section === 'appearance' ? (
          <SettingsCard title="界面主题" status={state.ui.theme === 'dark' ? '深色' : '浅色'}>
            <Segmented
              label="主题"
              value={state.ui.theme}
              options={['dark', 'light']}
              labels={['深色', '浅色']}
              disabled={themeAction.busy}
              onChange={(value) => void selectTheme(value as AppState['ui']['theme'])}
            />
            <InlineActionFeedback feedback={themeAction.feedback} />
          </SettingsCard>
        ) : null}
        <InlineActionFeedback feedback={saveAction.feedback} />
        <InlineActionFeedback feedback={settingsAction.feedback} />
        {section === 'llm' ? (
          <SettingsCard title="LLM 配置档案" status={secrets.configured(profileSecretId('llm', selectedLlmProfileId, 'apiKey')) ? '已配置' : '待配置'}>
            <LlmProfileManager
              config={draft}
              selectedProfileId={selectedLlmProfileId}
              models={modelLists.llm}
              loadingModels={loadingModelList === 'llm'}
              modelStatus={modelListStatus.llm}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => clearProviderModels('llm')}
              onRefreshModels={(profile) => {
                const secret = secrets.reference(profileSecretId('llm', profile.id, 'apiKey'));
                return refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: secret.value, protocol: profile.protocol, secretId: secret.secretId }, profile.model);
              }}
            />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard
            title="AI 绘图"
            status={secrets.configured(profileSecretId('image', selectedImageProfileId, selectedImageTestConfig.imageProvider === 'jimeng' ? 'jimeng/accessKeyId' : selectedImageTestConfig.imageProvider === 'custom' ? 'customImage/apiKey' : 'gptImage/apiKey')) ? '已配置' : '待配置'}
          >
            <ImageProfileManager
              config={draft}
              selectedProfileId={selectedImageProfileId}
              gptModels={modelLists['gpt-image']}
              customModels={modelLists['custom-image']}
              loadingModelList={loadingModelList}
              modelStatus={modelListStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedImageProfileId}
              onActivate={activateImageProfile}
              onClearModels={clearProviderModels}
              onRefreshModels={refreshProviderModels}
            />
          </SettingsCard>
        ) : null}
        {section === 'video' ? (
          <>
            <SettingsCard title="云端 VideoProvider" status={secrets.configured(activeVideoSecretId) ? '已配置' : '待配置'}>
              <ProviderConfigNote
                title="统一视频生成合同"
                value="支持同步 URL/base64 返回，也支持 task_id 异步轮询。业务任务只依赖能力声明，不绑定具体供应商名称。"
              />
              <SwitchField
                checked={activeVideoProvider.enabled}
                onChange={(_, data) => updateActiveVideoProvider({ enabled: data.checked })}
                label="启用当前云端视频 Provider"
              />
              <ConfigInput label="Provider 名称" value={activeVideoProvider.name} onChange={(value) => updateActiveVideoProvider({ name: value })} />
              <ConfigInput label="接口地址" value={activeVideoProvider.baseUrl} onChange={(value) => updateActiveVideoProvider({ baseUrl: value })} />
              <SecretInput
                label="接口密钥"
                value={secrets.value(activeVideoSecretId)}
                configured={secrets.configured(activeVideoSecretId)}
                onChange={(value) => secrets.change(activeVideoSecretId, value)}
                onClear={() => secrets.change(activeVideoSecretId, null)}
              />
              <ConfigInput label="视频模型" value={activeVideoProvider.model} onChange={(value) => updateActiveVideoProvider({ model: value })} />
              <ConfigInput label="提交路径" value={activeVideoProvider.submitPath} onChange={(value) => updateActiveVideoProvider({ submitPath: value })} />
              <ConfigInput label="状态路径模板" value={activeVideoProvider.statusPathTemplate} onChange={(value) => updateActiveVideoProvider({ statusPathTemplate: value })} />
              <ConfigNumberInput label="轮询间隔（秒）" value={activeVideoProvider.pollIntervalMs / 1000} min={0.25} step={0.25} onChange={(value) => updateActiveVideoProvider({ pollIntervalMs: value * 1000 })} />
              <ConfigNumberInput label="任务超时（秒）" value={activeVideoProvider.timeoutMs / 1000} min={10} step={10} onChange={(value) => updateActiveVideoProvider({ timeoutMs: value * 1000 })} />
              <ConfigNumberInput label="每秒费用" value={activeVideoProvider.pricePerSecond} min={0} step={0.01} onChange={(value) => updateActiveVideoProvider({ pricePerSecond: value })} />
              <ConfigNumberInput label="最长时长（秒）" value={activeVideoProvider.maxDurationSec} min={1} step={1} onChange={(value) => updateActiveVideoProvider({ maxDurationSec: value })} />
              <ConfigInput label="最高分辨率" value={activeVideoProvider.maxResolution} onChange={(value) => updateActiveVideoProvider({ maxResolution: value })} />
              <ConfigInput label="许可证说明" value={activeVideoProvider.license} onChange={(value) => updateActiveVideoProvider({ license: value })} />
              <ConfigInput label="附加请求参数（JSON）" value={activeVideoProvider.requestParamsJson} onChange={(value) => updateActiveVideoProvider({ requestParamsJson: value })} />
              <Field label="能力声明">
                <div className="settings-inline-actions">
                  {([
                    ['t2v', '文生视频'],
                    ['i2v', '图生视频'],
                    ['first-last-frame', '首尾帧'],
                    ['reference-image', '参考图'],
                    ['partial-redo', '局部重做'],
                    ['synchronized-audio', '同步音视频'],
                  ] as const).map(([capability, label]) => (
                    <ToggleField
                      key={capability}
                      label={label}
                      checked={activeVideoProvider.capabilities.includes(capability)}
                      onChange={(checked) => updateActiveVideoProvider({
                        capabilities: checked
                          ? Array.from(new Set([...activeVideoProvider.capabilities, capability]))
                          : activeVideoProvider.capabilities.filter((item) => item !== capability),
                      })}
                    />
                  ))}
                </div>
              </Field>
            </SettingsCard>
            <SettingsCard title="自动化与预算" status={draft.video.automation.mode === 'full-auto' ? '全自动' : '受控'}>
              <Segmented
                label="执行模式"
                value={draft.video.automation.mode}
                options={['full-auto', 'milestone-review', 'scene-review', 'manual']}
                labels={['全自动', '里程碑审批', '逐场景审批', '手动']}
                onChange={(value) => updateVideoAutomation({ mode: value as AppConfig['video']['automation']['mode'] })}
              />
              <ConfigNumberInput label="预算上限" value={draft.video.automation.budgetLimit} min={0} step={1} onChange={(value) => updateVideoAutomation({ budgetLimit: value })} />
              <ConfigNumberInput label="并发数" value={draft.video.automation.concurrency} min={1} step={1} onChange={(value) => updateVideoAutomation({ concurrency: value })} />
              <ConfigNumberInput label="失败重试次数" value={draft.video.automation.retryCount} min={0} step={1} onChange={(value) => updateVideoAutomation({ retryCount: value })} />
              <RangeField label="质量阈值" min={0} max={1} step={0.05} value={draft.video.automation.qualityThreshold} onChange={(value) => updateVideoAutomation({ qualityThreshold: value })} />
              <SwitchField
                checked={draft.video.automation.providerWhitelist.includes(activeVideoProvider.id)}
                onChange={(_, data) => updateVideoAutomation({
                  providerWhitelist: data.checked
                    ? Array.from(new Set([...draft.video.automation.providerWhitelist, activeVideoProvider.id]))
                    : draft.video.automation.providerWhitelist.filter((id) => id !== activeVideoProvider.id),
                })}
                label="允许调度当前 Provider"
              />
              <Segmented
                label="失败降级"
                value={draft.video.automation.fallback}
                options={['dynamic-image', 'html-video', 'disabled']}
                labels={['动态图片', 'HTML 动画', '不降级']}
                onChange={(value) => updateVideoAutomation({ fallback: value as AppConfig['video']['automation']['fallback'] })}
              />
            </SettingsCard>
          </>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 配音" status={secrets.configured(profileSecretId('tts', selectedTtsProfileId, selectedTtsTestConfig.tts.provider === 'minimax' ? 'minimax/apiKey' : 'volcengine/apiKey')) ? '已配置' : '待配置'}>
            <TtsProfileManager
              config={draft}
              selectedProfileId={selectedTtsProfileId}
              cloneVoices={minimaxCloneVoiceCatalog}
              volcengineSpeakers={volcengineSpeakers}
              loadingVolcengineSpeakers={loadingVolcengineSpeakers}
              volcengineSpeakerStatus={volcengineSpeakerStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedTtsProfileId}
              onActivate={activateTtsProfile}
              onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}
            />
            <MinimaxCloneVoiceManager
              api={api}
              applyState={applyState}
              initialVoices={minimaxCloneVoiceCatalog}
              onCatalogChange={setMinimaxCloneVoiceCatalog}
            />
          </SettingsCard>
        ) : null}
        {section === 'speechToText' ? (
          <SettingsCard title="语音转文字" status={secrets.configured('speechToText/apiKey') ? '已配置' : '待配置'}>
            <ProviderConfigNote
              title="转写 API"
              value="OpenAI 兼容 /audio/transcriptions；SiliconFlow 使用 file、model，默认 FunAudioLLM/SenseVoiceSmall，也可选 TeleAI/TeleSpeechASR。"
            />
            <Segmented
              label="供应商"
              value={draft.speechToText.provider}
              options={['openai-compatible', 'siliconflow']}
              labels={['OpenAI 兼容', 'SiliconFlow']}
              onChange={(value) => switchSpeechToTextProvider(value as AppConfig['speechToText']['provider'])}
            />
            <ConfigInput label="接口地址" value={draft.speechToText.baseUrl} onChange={(value) => updateSpeechToTextConfig({ baseUrl: value })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('speechToText/apiKey')}
              configured={secrets.configured('speechToText/apiKey')}
              onChange={(value) => secrets.change('speechToText/apiKey', value)}
              onClear={() => secrets.change('speechToText/apiKey', null)}
            />
            {isSiliconFlowSpeechToText ? (
              <Segmented
                label="转写模型"
                value={draft.speechToText.model}
                options={siliconFlowSpeechToTextModels}
                onChange={(value) => updateSpeechToTextConfig({ model: value })}
              />
            ) : (
              <ConfigInput label="转写模型" value={draft.speechToText.model} onChange={(value) => updateSpeechToTextConfig({ model: value })} />
            )}
            <ConfigInput label="语言" value={draft.speechToText.language} onChange={(value) => updateSpeechToTextConfig({ language: value })} />
            <ConfigInput label="提示词" value={draft.speechToText.prompt} onChange={(value) => updateSpeechToTextConfig({ prompt: value })} />
            {isSiliconFlowSpeechToText ? (
              <LocalInfo title="SiliconFlow 参数" value="按官方接口只提交 file 和 model，上传上限 50MB。language、prompt、temperature、时间戳和切分策略不会随请求发送。" />
            ) : (
              <Segmented
                label="响应格式"
                value={draft.speechToText.responseFormat}
                options={['json', 'verbose_json', 'text', 'srt', 'vtt']}
                labels={['JSON', 'Verbose JSON', 'Text', 'SRT', 'VTT']}
                onChange={(value) => updateSpeechToTextConfig({ responseFormat: value as AppConfig['speechToText']['responseFormat'] })}
              />
            )}
            {!isSiliconFlowSpeechToText ? <RangeField label="温度" min={0} max={1} step={0.1} value={draft.speechToText.temperature} onChange={(value) => updateSpeechToTextConfig({ temperature: value })} /> : null}
            <ConfigNumberInput
              label="请求超时（秒）"
              value={Math.round(draft.speechToText.timeoutMs / 1000)}
              min={10}
              step={10}
              onChange={(value) => updateSpeechToTextConfig({ timeoutMs: value * 1000 })}
            />
            {!isSiliconFlowSpeechToText ? (
              <Field label="时间戳">
                <div className="settings-inline-actions">
                  <ToggleField
                    label="段落级"
                    checked={draft.speechToText.timestampGranularities.includes('segment')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('segment', checked)}
                  />
                  <ToggleField
                    label="词级"
                    checked={draft.speechToText.timestampGranularities.includes('word')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('word', checked)}
                  />
                </div>
              </Field>
            ) : null}
            {!isSiliconFlowSpeechToText ? (
              <Segmented
                label="切分策略"
                value={draft.speechToText.chunkingStrategy}
                options={['none', 'auto']}
                labels={['不启用', '自动']}
                onChange={(value) => updateSpeechToTextConfig({ chunkingStrategy: value as AppConfig['speechToText']['chunkingStrategy'] })}
              />
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="剪映草稿与 BGM" status={draft.jianying.draftPath ? '已配置' : '待配置'}>
            <ConfigInput label="草稿目录" value={draft.jianying.draftPath} onChange={(value) => { setJianyingDetection(null); setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } }); }} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" disabled={settingsAction.busy} onClick={autoDetectJianyingDraftPath}><Search size={15} />自动检测</button>
              <button className="ghost-action" type="button" disabled={settingsAction.busy} onClick={pickJianyingDraftPath}><FolderOpen size={15} />选择目录</button>
            </div>
            {jianyingDetection ? (
              <div className="jianying-detection-result" data-status={jianyingDetection.status}>
                <div className="jianying-detection-head">
                  {jianyingDetection.status === 'pass' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                  <strong>{jianyingDetection.status === 'pass' ? '检测通过' : '未找到可用目录'}</strong>
                  {jianyingDetection.status === 'pass' ? <span>{state.config.jianying.draftPath === jianyingDetection.path ? '当前已保存' : '尚未保存'}</span> : null}
                </div>
                <p>{jianyingDetection.detail}</p>
                {jianyingDetection.path ? <code title={jianyingDetection.path}>{jianyingDetection.path}</code> : null}
                <div className="jianying-detection-checks">
                  <span>{jianyingDetection.checks.isDirectory ? '目录有效' : '未确认目录'}</span>
                  <span>{jianyingDetection.checks.writable ? '可写入' : '未确认写入权限'}</span>
                  <span>{jianyingDetection.checks.hasJianyingMetadata ? '剪映结构已确认' : `${jianyingDetection.draftCount} 个草稿`}</span>
                </div>
              </div>
            ) : null}
            <LocalInfo title="BGM 库" value={settingsBgms.length ? settingsBgms.map((bgm) => bgm.title).join('、') : 'BGM 库为空'} />
            <button className="ghost-action" type="button" disabled={settingsAction.busy} onClick={uploadBgmFromSettings}><Upload size={15} />+ 添加 BGM 文件</button>
            <div className="bgm-library-list">
              {settingsBgms.length === 0 ? <div className="bgm-library-empty">BGM 库为空</div> : null}
              {settingsBgms.map((bgm) => (
                <div key={bgm.id} className="bgm-library-item">
                  <div>
                    <strong>{bgm.title}</strong>
                    <span>{bgm.path}</span>
                  </div>
                  <label>
                    音量
                    <input type="number" min="0" max="1" step="0.05" value={bgm.volume} onChange={(event) => updateBgmVolume(bgm.id, Number(event.target.value))} />
                  </label>
                  <button className={draft.jianying.defaultBgmId === bgm.id ? 'mini-button active' : 'mini-button'} type="button" onClick={() => setDefaultBgm(bgm.id)}>
                    {draft.jianying.defaultBgmId === bgm.id ? '默认' : '设为默认'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => removeBgm(bgm.id)}>移除</button>
                </div>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="激活与订阅" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 创作 / IMA 知识库" status={secrets.configured('ima/apiKey') ? '已配置' : '待配置'}>
            <ConfigInput label="客户端 ID" value={draft.ima.clientId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('ima/apiKey')}
              configured={secrets.configured('ima/apiKey')}
              onChange={(value) => secrets.change('ima/apiKey', value)}
              onClear={() => secrets.change('ima/apiKey', null)}
            />
            <ConfigInput label="知识库 ID" value={draft.ima.kbId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbId: value } })} />
            <ConfigInput label="知识库名称" value={draft.ima.kbName} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
            <button className="ghost-action" disabled={settingsAction.busy || savingConfig} onClick={fetchImaKnowledgeFromSettings}>
              {settingsAction.busy ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
              测试并拉取知识库
            </button>
            {imaKnowledgeResult ? (
              <div className="test-result">
                <strong>{imaKnowledgeResult.knowledgeBaseId || 'IMA'}</strong>
                <span>{imaKnowledgeResult.detail}</span>
                {imaKnowledgeResult.records.map((record) => (
                  <div key={record.id}><strong>{record.title}</strong><span>{record.snippet || '无摘要'}</span></div>
                ))}
              </div>
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'webSearch' ? (
          <SettingsCard title="联网搜索" status={settingsStatusLabel(configTargetStatus('webSearch', draftWithCredentialStatus))}>
            <ConfigInput
              label="SearXNG 服务地址（可选）"
              value={draft.webSearch.searxngBaseUrl}
              onChange={(value) => setSettingsDraft({ ...draft, webSearch: { ...draft.webSearch, searxngBaseUrl: value } })}
            />
            <div className="settings-help-text">推荐填写自己部署的 SearXNG，例如 http://127.0.0.1:8080。留空时直接使用 Tavily Keyless 备用搜索。</div>
            <SwitchField
              checked={draft.webSearch.tavilyKeylessEnabled}
              onChange={(_, data) => setSettingsDraft({ ...draft, webSearch: { ...draft.webSearch, tavilyKeylessEnabled: data.checked } })}
              label="启用 Tavily Keyless 备用"
            />
            <SwitchField
              checked={draft.webSearch.legacyFallbackEnabled}
              onChange={(_, data) => setSettingsDraft({ ...draft, webSearch: { ...draft.webSearch, legacyFallbackEnabled: data.checked } })}
              label="启用 Bing / 百度 / 搜狗 / 头条兼容降级"
            />
            <div className="settings-help-text">搜索顺序：SearXNG → Tavily Keyless → 兼容搜索源。搜索结果发现与正文读取分离，正文打不开不会丢失搜索结果。</div>
          </SettingsCard>
        ) : null}
        {section === 'about' ? (
          <div className="diagnostics-card">
            <LocalInfo title="视频故事创作助手" value="V1.0.0 · Windows · 本地数据目录" />
            <div className="button-row">
              <button className="ghost-action" disabled={settingsAction.busy} onClick={runDiagnostics}>检查诊断</button>
              <button className="ghost-action" onClick={() => navigator.clipboard?.writeText(diagnostics)}>
                <Copy size={15} />
                复制诊断报告
              </button>
              <button className="danger-action" onClick={() => navigate('history')}><XCircle size={15} />清理历史</button>
            </div>
            <pre>{diagnostics || '点击检查诊断后显示 LLM、TTS、BGM、剪映目录、账户状态等检查结果。'}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
