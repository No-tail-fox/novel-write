import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, Copy, Database, Eye, Film, FlaskConical, FolderOpen, Globe2, Image as ImageIcon, Info, KeyRound, Loader2, Mic2, Music2, Palette, Save, Search, Sparkles, Upload, Wand2, XCircle } from "lucide-react";
import { useMemo } from "react";
import type { AppConfig, ConfigTestTarget, ImaKnowledgeResult, ProviderModel, ProviderModelListRequest, ShellView, ThemeName, TtsProviderProfile, VolcengineSpeaker } from "../../shared/types";
import type { StoryDreamApi } from "../../shared/storydream-api";
import type { JianyingDraftPathDetection } from "../../shared/jianying-paths";
import { addUploadedBgm, resolveDefaultBgmId, validBgmItems } from "../tasks/task-formatters";
import type { SecretChanges, SecretId } from "../../shared/config-secrets";
import { changeRuntimeTheme, type RuntimeThemeStateSynchronizer } from "./theme-controller";
import { configTargetStatus } from "../../shared/config-utils";
import { activeImageProfileId, activeLlmProfileId, activeMusicProfileId, activeTtsProfileId, activeVideoProfileId, buildConfigForSelectedProfileTest, enableImageProfile, enableLlmProfile, enableMusicProfile, enableTtsProfile, enableVideoProfile, getMusicProfile, getVideoProfile, normalizeEditableConfigProviders, ttsProfileVolcengine } from "../../shared/provider-profile-utils";
import { activeSpeechToTextProfileId, activeVisionProfileId, enableSpeechToTextProfile, enableVisionProfile, getSpeechToTextProfile, getVisionProfile } from '../../shared/provider-profile-utils';
import { useAsyncAction } from "../../ui/async-action";
import { FormField as Field } from "../../components/FormField";
import { SegmentedControl as Segmented } from "../../components/SegmentedControl";
import { ToggleField } from "../../components/ToggleField";
import { Button, SelectField, SwitchField, TextField } from '../../ui';
import { RangeField } from "../../components/RangeField";
import { AsyncActionFeedback as InlineActionFeedback } from "../../components/AsyncActionFeedback";
import type { ApplyMutationResult, RendererAppState as AppState } from "../../app/route-types";
import { siliconFlowSpeechToTextBaseUrl, siliconFlowSpeechToTextModels } from "../../shared/editorial-options";
import { ImageProfileManager, LlmProfileManager, TtsProfileManager } from './ProviderProfileManagers';
import { MinimaxCloneVoiceManager } from './MinimaxCloneVoiceManager';
import { ProviderPortalLinks } from './ProviderPortalLinks';
import { MusicProfileManager, ProfileSecretField, TranscriptionVisionProfileSwitcher, VideoProfileSwitcher, VisionProfileManager } from './MusicVideoProfileManagers';
import { providerKeyPortals } from '../../shared/provider-portals';
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

export type SettingsSection = 'appearance' | 'llm' | 'image' | 'video' | 'music' | 'tts' | 'speechToText' | 'vision' | 'jianying' | 'activation' | 'creative' | 'webSearch' | 'about';

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
  const [selectedMusicProfileId, setSelectedMusicProfileId] = useState(() => activeMusicProfileId(state.config));
  const [selectedVideoProfileId, setSelectedVideoProfileId] = useState(() => activeVideoProfileId(state.config));
  const [selectedSpeechToTextProfileId, setSelectedSpeechToTextProfileId] = useState(() => activeSpeechToTextProfileId(state.config));
  const [selectedVisionProfileId, setSelectedVisionProfileId] = useState(() => activeVisionProfileId(state.config));
  const [minimaxCloneVoiceCatalog, setMinimaxCloneVoiceCatalog] = useState(() => state.minimaxCloneVoices);
  const saveAction = useAsyncAction();
  const settingsAction = useAsyncAction();
  const themeAction = useAsyncAction();
  const draftRevision = useRef(0);
  useUnsavedChanges({
    id: 'settings', label: '系统设置', dirty: settingsDirty, busy: savingConfig,
    onSave: async () => Boolean(await save()),
    onDiscard: () => commitSettingsDraft(state.config),
  });
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
    draftRevision.current++;
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
    const submittedRevision = draftRevision.current;
    setSavingConfig(true);
    try {
      const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
      const savedConfig = configFromMutation(next);
      const unchanged = submittedRevision === draftRevision.current;
      if (unchanged) commitSettingsDraft(savedConfig);
      applyState(next);
      setConfigTestResult(unchanged ? `[pass] ${successMessage}` : '[warn] 已保存提交时的配置，后续修改仍未保存。');
      return unchanged ? savedConfig : undefined;
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
    draftRevision.current++;
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
    return commitAndApplySettingsDraft(draft);
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '已启用 LLM 配置档案');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '已启用绘图配置档案');
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '已启用旁白服务配置档案');
  }
  async function activateMusicProfile(id: string) {
    await commitAndApplySettingsDraft(enableMusicProfile(draft, id), '已启用音乐创作配置');
  }
  async function activateVideoProfile(id: string) {
    await commitAndApplySettingsDraft(enableVideoProfile(draft, id), '已启用视频生成配置');
  }
  async function activateSpeechToTextProfile(id: string) {
    await commitAndApplySettingsDraft(enableSpeechToTextProfile(draft, id), '已启用语音转文字配置');
  }
  async function activateVisionProfile(id: string) {
    await commitAndApplySettingsDraft(enableVisionProfile(draft, id), '已启用视觉分析配置');
  }
  async function testCurrentConfig() {
    const submittedRevision = draftRevision.current;
    const target: ConfigTestTarget =
      section === 'llm' || section === 'image' || section === 'video' || section === 'music' || section === 'tts' || section === 'speechToText' || section === 'vision' || section === 'jianying' || section === 'creative' || section === 'webSearch'
        ? section
        : 'llm';
    await settingsAction.run(async () => {
      setTestingConfig(true);
      setSavingConfig(true);
      setConfigTestResult('正在保存并测试当前配置...');
      try {
        const next = await api.saveConfig({ config: normalizeEditableConfigProviders(draft), secretChanges });
        const savedConfig = configFromMutation(next);
        if (submittedRevision === draftRevision.current) commitSettingsDraft(savedConfig);
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
    const accessKeyIdId = profileSecretId('tts', profile.id, 'volcengine/accessKeyId');
    const secretAccessKeyId = profileSecretId('tts', profile.id, 'volcengine/secretAccessKey');
    const accessKeyId = secrets.reference(accessKeyIdId);
    const secretAccessKey = secrets.reference(secretAccessKeyId);
    if (!secrets.configured(accessKeyIdId) || !secrets.configured(secretAccessKeyId)) {
      setVolcengineSpeakerStatus('[失败] 加载火山音色列表需要填写访问密钥 ID 和访问密钥 Secret。');
      return;
    }

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
          limit,
        };
        const first = await api.listVolcengineSpeakers({ ...request, page: 1 });
        if (first.status === 'fail') {
          setVolcengineSpeakerStatus(`[fail] ${first.detail}`);
          return;
        }
        let speakers = mergeVolcengineSpeakers([], first.speakers);
        const total = first.total || speakers.length;
        let pageError = '';
        if (total > speakers.length) {
          const pageCount = Math.min(Math.ceil(total / limit), 20);
          for (let page = 2; page <= pageCount; page += 1) {
            const next = await api.listVolcengineSpeakers({ ...request, page });
            if (next.status === 'fail') { pageError = next.detail; break; }
            if (!next.speakers.length) break;
            speakers = mergeVolcengineSpeakers(speakers, next.speakers);
            if (speakers.length >= total) break;
          }
        }
        setVolcengineSpeakers(speakers);
        const loadedText = speakers.length > first.speakers.length ? `，已合并 ${speakers.length}/${total} 个` : '';
        setVolcengineSpeakerStatus(speakers.length < total
          ? `[warn] 已加载 ${speakers.length}/${total} 个音色，列表尚未加载完整。${pageError}`
          : `[${first.status}] ${first.detail}${loadedText}`);
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
      if (!savedConfig) return;
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
  function updateSpeechToTextConfig(patch: Partial<AppConfig['speechToTextProfiles'][number]>) {
    setSettingsDraft((current) => ({ ...current, speechToTextProfiles: current.speechToTextProfiles.map((profile) => profile.id === selectedSpeechToTextProfileId ? { ...profile, ...patch } : profile) }));
  }
  function updateSelectedVideoProvider(patch: Partial<AppConfig['video']['providers'][number]>) {
    setSettingsDraft((current) => ({ ...current, video: { ...current.video, providers: current.video.providers.map((profile) => profile.id === selectedVideoProfileId ? { ...profile, ...patch } : profile) } }));
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
      baseUrl: selectedSpeechToTextProfile.baseUrl.includes('siliconflow') ? 'https://api.openai.com/v1' : selectedSpeechToTextProfile.baseUrl,
      model: siliconFlowSpeechToTextModels.includes(selectedSpeechToTextProfile.model) ? 'whisper-1' : selectedSpeechToTextProfile.model,
    });
  }
  function toggleSpeechToTextTimestamp(granularity: AppConfig['speechToText']['timestampGranularities'][number], checked: boolean) {
    const current = selectedSpeechToTextProfile.timestampGranularities.filter((item) => item !== granularity);
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
    music: selectedMusicProfileId,
    video: selectedVideoProfileId,
    speechToText: selectedSpeechToTextProfileId,
    vision: selectedVisionProfileId,
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
  const selectedVideoProvider = draft.video.providers.find((profile) => profile.id === selectedVideoProfileId) ?? getVideoProfile(draft, selectedVideoProfileId);
  const selectedVideoSecretId = profileSecretId('video', selectedVideoProvider.id, 'apiKey');
  const selectedVideoTestConfig = buildConfigForSelectedProfileTest(draft, 'video', selectedProviderProfileIds);
  const selectedMusicProfile = getMusicProfile(draft, selectedMusicProfileId);
  const selectedSpeechToTextProfile = draft.speechToTextProfiles.find((profile) => profile.id === selectedSpeechToTextProfileId) ?? getSpeechToTextProfile(draft, selectedSpeechToTextProfileId);
  const selectedSpeechToTextSecretId = profileSecretId('speechToText', selectedSpeechToTextProfile.id, 'apiKey');
  const selectedSpeechToTextTestConfig = buildConfigForSelectedProfileTest(draft, 'speechToText', selectedProviderProfileIds);
  const selectedVisionProfile = getVisionProfile(draft, selectedVisionProfileId);
  const settingsBgms = validBgmItems(draft);
  const isSiliconFlowSpeechToText = selectedSpeechToTextProfile.provider === 'siliconflow';
  const sections = [
    ['appearance', Palette, '外观', '明暗主题', state.ui.theme === 'dark' ? '深色' : '浅色'],
    ['llm', Sparkles, 'LLM', '文案与分镜', settingsStatusLabel(configTargetStatus('llm', draftWithCredentialStatus))],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', settingsStatusLabel(configTargetStatus('image', draftWithCredentialStatus))],
    ['video', Film, 'AI 视频', '云端生成 · 调度', settingsStatusLabel(configTargetStatus('video', draftWithCredentialStatus))],
    ['music', Music2, '音乐创作', 'Suno · 生成与音色', draft.music.enabled ? (getMusicProfile(draft).useEnvironmentKey ? '系统密钥' : settingsStatusLabel(configTargetStatus('music', draftWithCredentialStatus))) : '已关闭'],
    ['tts', Bot, '旁白服务', '每镜配音（TTS）', settingsStatusLabel(configTargetStatus('tts', draftWithCredentialStatus))],
    ['speechToText', Mic2, '语音转文字', '爆款拆解转写 API', settingsStatusLabel(configTargetStatus('speechToText', draftWithCredentialStatus))],
    ['vision', Eye, '视觉分析', '视频关键帧理解', settingsStatusLabel(configTargetStatus('vision', draftWithCredentialStatus))],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', settingsStatusLabel(configTargetStatus('jianying', draftWithCredentialStatus))],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', settingsStatusLabel(configTargetStatus('creative', draftWithCredentialStatus))],
    ['webSearch', Globe2, '联网搜索', 'Agent Search · SearXNG · Tavily · 兼容源', settingsStatusLabel(configTargetStatus('webSearch', draftWithCredentialStatus))],
    ['about', Info, '关于 · 诊断', '日志 · 重置', '已配置'],
  ] as const;
  const returnLabel = returnView === 'music-lab' ? '返回音乐创作' : returnView === 'editorial-collage' ? '返回 VOX 视频' : returnView === 'motion-comic' ? '返回 AI 漫剧' : '返回创作首页';
  return (
    <div className="settings-layout">
      <section className="settings-menu">
        {onReturn ? <Button className="settings-return-action" variant="subtle" icon={<ArrowLeft size={14} />} onClick={onReturn}>{returnLabel}</Button> : null}
        <SelectField
          fieldClassName="settings-section-select"
          label="设置分类"
          value={section}
          options={sections.map(([value, , label]) => ({ value, label }))}
          onChange={(event) => setSection(event.target.value as SettingsSection)}
        />
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
        {section === 'llm' || section === 'image' || section === 'tts' ? <p className="settings-profile-explanation">可保存多个模型配置，选中用于编辑，启用用于创作。保存或测试所选配置会保留当前启用项。</p> : null}
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
              saving={savingConfig || testingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => { clearProviderModels('llm'); setConfigTestResult(''); }}
              onRefreshModels={(profile) => {
                const secret = secrets.reference(profileSecretId('llm', profile.id, 'apiKey'));
                return refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: secret.value, protocol: profile.protocol, secretId: secret.secretId }, profile.model);
              }}
            />
            <ProviderPortalLinks links={providerKeyPortals('llm', selectedLlmTestConfig)} onOpen={api.openProviderPortal} />
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
            <ProviderPortalLinks links={providerKeyPortals('image', selectedImageTestConfig)} onOpen={api.openProviderPortal} />
          </SettingsCard>
        ) : null}
        {section === 'video' ? (
          <>
            <SettingsCard title="视频生成服务" status={secrets.configured(selectedVideoSecretId) ? '已配置' : '待配置'}>
              <VideoProfileSwitcher config={draft} selectedProfileId={selectedVideoProfileId} saving={savingConfig || testingConfig}
                onChange={setSettingsDraft} onSelectedProfileIdChange={setSelectedVideoProfileId} onActivate={activateVideoProfile} />
              <ProviderConfigNote
                title="统一视频生成合同"
                value="支持同步 URL/base64 返回，也支持 task_id 异步轮询。业务任务只依赖能力声明，不绑定具体供应商名称。"
              />
              <ConfigInput label="Provider 名称" value={selectedVideoProvider.name} onChange={(value) => updateSelectedVideoProvider({ name: value })} />
              <ConfigInput label="接口地址" value={selectedVideoProvider.baseUrl} onChange={(value) => updateSelectedVideoProvider({ baseUrl: value })} />
              <ProfileSecretField domain="video" profileId={selectedVideoProvider.id} secrets={secrets} />
              <ConfigInput label="视频模型" value={selectedVideoProvider.model} onChange={(value) => updateSelectedVideoProvider({ model: value })} />
              <ConfigInput label="提交路径" value={selectedVideoProvider.submitPath} onChange={(value) => updateSelectedVideoProvider({ submitPath: value })} />
              <ConfigInput label="状态路径模板" value={selectedVideoProvider.statusPathTemplate} onChange={(value) => updateSelectedVideoProvider({ statusPathTemplate: value })} />
              <ConfigNumberInput label="轮询间隔（秒）" value={selectedVideoProvider.pollIntervalMs / 1000} min={0.25} step={0.25} onChange={(value) => updateSelectedVideoProvider({ pollIntervalMs: value * 1000 })} />
              <ConfigNumberInput label="任务超时（秒）" value={selectedVideoProvider.timeoutMs / 1000} min={10} step={10} onChange={(value) => updateSelectedVideoProvider({ timeoutMs: value * 1000 })} />
              <ConfigNumberInput label="每秒费用" value={selectedVideoProvider.pricePerSecond} min={0} step={0.01} onChange={(value) => updateSelectedVideoProvider({ pricePerSecond: value })} />
              <ConfigNumberInput label="最长时长（秒）" value={selectedVideoProvider.maxDurationSec} min={1} step={1} onChange={(value) => updateSelectedVideoProvider({ maxDurationSec: value })} />
              <ConfigInput label="最高分辨率" value={selectedVideoProvider.maxResolution} onChange={(value) => updateSelectedVideoProvider({ maxResolution: value })} />
              <ConfigInput label="许可证说明" value={selectedVideoProvider.license} onChange={(value) => updateSelectedVideoProvider({ license: value })} />
              <ConfigInput label="附加请求参数（JSON）" value={selectedVideoProvider.requestParamsJson} onChange={(value) => updateSelectedVideoProvider({ requestParamsJson: value })} />
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
                      checked={selectedVideoProvider.capabilities.includes(capability)}
                      onChange={(checked) => updateSelectedVideoProvider({
                        capabilities: checked
                          ? Array.from(new Set([...selectedVideoProvider.capabilities, capability]))
                          : selectedVideoProvider.capabilities.filter((item) => item !== capability),
                      })}
                    />
                  ))}
                </div>
              </Field>
              <ProviderPortalLinks links={providerKeyPortals('video', selectedVideoTestConfig)} onOpen={api.openProviderPortal} />
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
                checked={draft.video.automation.providerWhitelist.includes(selectedVideoProvider.id)}
                onChange={(_, data) => updateVideoAutomation({
                  providerWhitelist: data.checked
                    ? Array.from(new Set([...draft.video.automation.providerWhitelist, selectedVideoProvider.id]))
                    : draft.video.automation.providerWhitelist.filter((id) => id !== selectedVideoProvider.id),
                })}
                label="允许自动调度正在编辑的配置"
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
        {section === 'music' ? (
          <SettingsCard title="音乐创作 API" status={selectedMusicProfile.useEnvironmentKey ? '使用系统密钥' : secrets.configured(profileSecretId('music', selectedMusicProfile.id, 'apiKey')) ? '已配置' : '待配置'}>
            <MusicProfileManager config={draft} selectedProfileId={selectedMusicProfileId} saving={savingConfig || testingConfig} secrets={secrets}
              onChange={setSettingsDraft} onSelectedProfileIdChange={setSelectedMusicProfileId} onActivate={activateMusicProfile} />
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="旁白服务（TTS）" status={secrets.configured(profileSecretId('tts', selectedTtsProfileId, selectedTtsTestConfig.tts.provider === 'minimax' ? 'minimax/apiKey' : 'volcengine/apiKey')) ? '已配置' : '待配置'}>
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
            <ProviderPortalLinks links={providerKeyPortals('tts', selectedTtsTestConfig)} onOpen={api.openProviderPortal} />
            <MinimaxCloneVoiceManager
              api={api}
              applyState={applyState}
              initialVoices={minimaxCloneVoiceCatalog}
              onCatalogChange={setMinimaxCloneVoiceCatalog}
            />
          </SettingsCard>
        ) : null}
        {section === 'speechToText' ? (
          <SettingsCard title="语音转文字" status={secrets.configured(selectedSpeechToTextSecretId) ? '已配置' : '待配置'}>
            <TranscriptionVisionProfileSwitcher domain="speechToText" config={draft} selectedProfileId={selectedSpeechToTextProfileId} saving={savingConfig || testingConfig}
              onChange={setSettingsDraft} onSelectedProfileIdChange={setSelectedSpeechToTextProfileId} onActivate={activateSpeechToTextProfile} />
            <ProviderConfigNote
              title="转写 API"
              value="OpenAI 兼容 /audio/transcriptions；SiliconFlow 使用 file、model，默认 FunAudioLLM/SenseVoiceSmall，也可选 TeleAI/TeleSpeechASR。"
            />
            <Segmented
              label="供应商"
              value={selectedSpeechToTextProfile.provider}
              options={['openai-compatible', 'siliconflow']}
              labels={['OpenAI 兼容', 'SiliconFlow']}
              onChange={(value) => switchSpeechToTextProvider(value as AppConfig['speechToText']['provider'])}
            />
            <TextField label="配置名称" value={selectedSpeechToTextProfile.name} onChange={(_, data) => updateSpeechToTextConfig({ name: data.value })} />
            <ConfigInput label="接口地址" value={selectedSpeechToTextProfile.baseUrl} onChange={(value) => updateSpeechToTextConfig({ baseUrl: value })} />
            <ProfileSecretField domain="speechToText" profileId={selectedSpeechToTextProfile.id} secrets={secrets} />
            {isSiliconFlowSpeechToText ? (
              <Segmented
                label="转写模型"
                value={selectedSpeechToTextProfile.model}
                options={siliconFlowSpeechToTextModels}
                onChange={(value) => updateSpeechToTextConfig({ model: value })}
              />
            ) : (
              <ConfigInput label="转写模型" value={selectedSpeechToTextProfile.model} onChange={(value) => updateSpeechToTextConfig({ model: value })} />
            )}
            <ConfigInput label="语言" value={selectedSpeechToTextProfile.language} onChange={(value) => updateSpeechToTextConfig({ language: value })} />
            <ConfigInput label="提示词" value={selectedSpeechToTextProfile.prompt} onChange={(value) => updateSpeechToTextConfig({ prompt: value })} />
            {isSiliconFlowSpeechToText ? (
              <LocalInfo title="SiliconFlow 参数" value="按官方接口只提交 file 和 model，上传上限 50MB。language、prompt、temperature、时间戳和切分策略不会随请求发送。" />
            ) : (
              <Segmented
                label="响应格式"
                value={selectedSpeechToTextProfile.responseFormat}
                options={['json', 'verbose_json', 'text', 'srt', 'vtt']}
                labels={['JSON', 'Verbose JSON', 'Text', 'SRT', 'VTT']}
                onChange={(value) => updateSpeechToTextConfig({ responseFormat: value as AppConfig['speechToText']['responseFormat'] })}
              />
            )}
            {!isSiliconFlowSpeechToText ? <RangeField label="温度" min={0} max={1} step={0.1} value={selectedSpeechToTextProfile.temperature} onChange={(value) => updateSpeechToTextConfig({ temperature: value })} /> : null}
            <ConfigNumberInput
              label="请求超时（秒）"
              value={Math.round(selectedSpeechToTextProfile.timeoutMs / 1000)}
              min={10}
              step={10}
              onChange={(value) => updateSpeechToTextConfig({ timeoutMs: value * 1000 })}
            />
            {!isSiliconFlowSpeechToText ? (
              <Field label="时间戳">
                <div className="settings-inline-actions">
                  <ToggleField
                    label="段落级"
                    checked={selectedSpeechToTextProfile.timestampGranularities.includes('segment')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('segment', checked)}
                  />
                  <ToggleField
                    label="词级"
                    checked={selectedSpeechToTextProfile.timestampGranularities.includes('word')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('word', checked)}
                  />
                </div>
              </Field>
            ) : null}
            {!isSiliconFlowSpeechToText ? (
              <Segmented
                label="切分策略"
                value={selectedSpeechToTextProfile.chunkingStrategy}
                options={['none', 'auto']}
                labels={['不启用', '自动']}
                onChange={(value) => updateSpeechToTextConfig({ chunkingStrategy: value as AppConfig['speechToText']['chunkingStrategy'] })}
              />
            ) : null}
            <ProviderPortalLinks links={providerKeyPortals('speechToText', selectedSpeechToTextTestConfig)} onOpen={api.openProviderPortal} />
          </SettingsCard>
        ) : null}
        {section === 'vision' ? (
          <SettingsCard title="视觉分析模型" status={secrets.configured(profileSecretId('viralVision', selectedVisionProfile.id, 'apiKey')) ? '已配置' : '待配置'}>
            <VisionProfileManager config={draft} selectedProfileId={selectedVisionProfileId} saving={savingConfig || testingConfig} secrets={secrets}
              onChange={setSettingsDraft} onSelectedProfileIdChange={setSelectedVisionProfileId} onActivate={activateVisionProfile} />
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
            <SwitchField
              checked={draft.webSearch.agentSearchEnabled}
              onChange={(_, data) => setSettingsDraft({ ...draft, webSearch: { ...draft.webSearch, agentSearchEnabled: data.checked } })}
              label="启用 Agent Search 聚合搜索"
            />
            <div className="settings-help-text">内置免 Key 多引擎搜索。不可用、超时或没有结果时会自动尝试后续搜索源。</div>
            <ConfigInput
              label="SearXNG 服务地址（可选）"
              value={draft.webSearch.searxngBaseUrl}
              onChange={(value) => setSettingsDraft({ ...draft, webSearch: { ...draft.webSearch, searxngBaseUrl: value } })}
            />
            <div className="settings-help-text">推荐填写自己部署的 SearXNG，例如 http://127.0.0.1:8080。留空时跳过该后端。</div>
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
            <div className="settings-help-text">搜索顺序：Agent Search → SearXNG → Tavily Keyless → 兼容搜索源。搜索结果发现与正文读取分离，正文打不开不会丢失搜索结果。</div>
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
