import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Bell,
  Bot,
  Circle,
  Coins,
  Copy,
  Database,
  FileJson,
  Flame,
  FlaskConical,
  FolderOpen,
  History,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Maximize2,
  Mic2,
  Minus,
  Music,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Upload,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AiSourceSection,
  AppConfig,
  AppState,
  ConfigTestTarget,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CustomStyle,
  DraftTemplate,
  DraftTextBorder,
  ImageLabGenerateInput,
  ImageProviderProfile,
  ImageLabRecord,
  ImageLabSmartMode,
  BgmItem,
  JianyingEffectCatalog,
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  PromptTemplate,
  PromptStepTemplateType,
  PromptTemplateType,
  ProviderModel,
  RewriteIntensity,
  ShellView,
  Task,
  TaskArtifactSnapshot,
  ViralAnalysisEvent,
  TaskEvent,
  TaskMode,
  TaskStatus,
  TaskStepRerunMode,
  TaskVideoForm,
  TtsProviderProfile,
  UiPreferences,
  VolcengineSpeaker,
  ViralAnalysisResult,
  ViralAnalysisStatus,
  ViralPlatform,
  VoiceLabGenerateInput,
  VoiceLabRecord,
} from './shared/types';
import { configTargetStatus, normalizeAppConfig, validateConfigTarget } from './shared/config-utils';
import {
  activeImageProfileId,
  activeLlmProfileId,
  activeTtsProfileId,
  activateSelectedProviderProfileForTarget,
  addImageProfile,
  addLlmProfile,
  addTtsProfile,
  buildConfigForSelectedProfileTest,
  copyImageProfile,
  copyLlmProfile,
  copyTtsProfile,
  editableLlmProfileProvider,
  enableImageProfile,
  enableLlmProfile,
  enableTtsProfile,
  imageProfileCustomImage,
  imageProfileGptImage,
  imageProfileJimeng,
  normalizeEditableConfigProviders,
  normalizedImageProfiles,
  normalizedTtsProfiles,
  removeImageProfile,
  removeLlmProfile,
  removeTtsProfile,
  saveImageProfile,
  saveLlmProfile,
  saveTtsProfile,
  ttsProfileMinimax,
  ttsProfileVolcengine,
} from './shared/provider-profile-utils';
import { listOpenAiCompatibleModels } from './shared/llm-provider';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomCoverTemplates,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultPromptTemplates,
  defaultUiPreferences,
} from './shared/config';
import { draftTemplates as builtinDraftTemplates, imageAnimations, normalizeDraftTemplate } from './shared/templates';
import { convertCozeWorkflowToDraftTemplate, convertManyCozeWorkflowsToDraftTemplates, type CozeWorkflowTemplateConversionResult } from './shared/coze-workflow-converter';
import {
  buildImageTemplateStyleOptions,
  buildStoryTemplateOptions,
  buildTaskPromptTemplateOptions,
  buildStoryTemplateTrackOptions,
  resolvePromptTemplateDefaultDraftTemplateId,
  resolvePromptTemplateDefaultStyleId,
  resolvePromptTemplateDefaultStyleIds,
  selectStepPromptTemplate,
  selectTaskPromptTemplate,
} from './shared/prompt-templates';
import { createViralTemplateDrafts } from './shared/viral-template-extraction';
import { defaultPodcastSpeakersForProvider, defaultTaskSpeakerForProvider, normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider, type RuntimeTtsProvider } from './shared/tts-voices';
import feishuCozeDraftTemplateBundle from '../data/coze-workflows/feishu-draft-templates.json';
import './styles.css';

const sampleText =
  '姝︽泴锛岄€氱О姝﹀垯澶┿€佹鍚庯紝鏄腑鍥藉巻鍙蹭笂鍞竴鐨勫コ鐨囧笣銆傛鍒欏ぉ鍗佸洓宀佸叆瀹负鍞愬お瀹楁墠浜猴紝鍘嗙粡鍗佷簩骞翠笉寰楀崌杩併€傚攼楂樺畻鏃跺涓烘槶浠紝閫氳繃搴熼粶鐜嬬殗鍚庝笌钀ф窇濡冿紝寰椾互绔嬩负鐨囧悗銆傚苟灏婂彿涓哄ぉ鍚庯紝涓庡攼楂樺畻骞剁О浜屽湥銆?;

const initialState: AppState = {
  config: defaultConfig,
  tasks: [],
  events: [],
  viralAnalyses: [],
  viralEvents: [],
  promptTemplates: defaultPromptTemplates,
  draftTemplates: builtinDraftTemplates,
  imageLabRecords: [],
  voiceLabRecords: [],
  customStyles: defaultCustomStyles,
  customCoverTemplates: defaultCustomCoverTemplates,
  creditTransactions: defaultCreditTransactions,
  minimaxCloneVoices: defaultMinimaxCloneVoices,
  account: defaultAccount,
  activation: defaultActivation,
  ui: defaultUiPreferences,
};

type NavItem = { view: ShellView; label: string; hint: string; icon: React.ComponentType<{ size?: number }> };

const primaryNavItems: NavItem[] = [
  { view: 'new-task', label: '鏂板缓浠诲姟', hint: '绱犳潗鎴愮墖', icon: Plus },
  { view: 'queue', label: '浠诲姟闃熷垪', hint: '杩愯杩涘害', icon: ListChecks },
  { view: 'history', label: '鍘嗗彶浠诲姟', hint: '鏈湴璁板綍', icon: History },
  { view: 'image-lab', label: '鐢诲浘瀹為獙瀹?, hint: '鍒嗛暅鍥剧墖', icon: FlaskConical },
  { view: 'voice-lab', label: '閰嶉煶瀹為獙瀹?, hint: '闊宠壊璇曞惉', icon: Mic2 },
  { view: 'music-mv', label: '闊充箰 MV', hint: '姝岃瘝鎴愮墖', icon: Music },
  { view: 'viral-analyzer', label: '鐖嗘鎷嗚В', hint: '鎷夌墖澶嶅埢', icon: Flame },
  { view: 'prompt-templates', label: '鎻愮ず璇嶆ā鏉?, hint: '浠ｇ悊鎻愮ず璇?, icon: Sparkles },
  { view: 'draft-templates', label: '鑽夌妯℃澘', hint: '鍓槧鐢诲竷', icon: LayoutTemplate },
  { view: 'settings', label: '绯荤粺璁剧疆', hint: 'API 涓庤矾寰?, icon: Settings },
  { view: 'account', label: '璐︽埛涓績', hint: '璧勬枡涓庣Н鍒?, icon: Circle },
  { view: 'activation', label: '婵€娲荤鐞?, hint: '璇曠敤涓庢巿鏉?, icon: KeyRound },
];

const secondaryNavItems: NavItem[] = [];

const navItems: NavItem[] = [...primaryNavItems, ...secondaryNavItems];

const contentTracks = [
  ['character-story', '浜虹墿鏁呬簨', '鍘嗗彶浜虹墿 / 鍚嶄汉浼犺'],
  ['health-book', '鍋ュ悍鍥句功', '鍋ュ悍鍏荤敓 / 鍖诲鐭ヨ瘑'],
  ['culture-science', '鏂囧寲绉戞櫘', '鍗庡鏂囧寲 / 浼犵粺姘戜織'],
  ['picture-book', '缁樻湰鏁呬簨', '鍎跨缁樻湰 / 鐫″墠鏁呬簨'],
  ['ecommerce', '鐢靛晢甯﹁揣', '浜у搧绉嶈崏 / 濂界墿鎺ㄨ崘'],
  ['mind-soup', '蹇冪伒楦℃堡', '鎯呮劅娌绘剤 / 鍔卞織鎰熸偀'],
  ['folk-story', '姘戦棿鏁呬簨', '铏氭瀯浼犺 / 鍥犳灉瀵撹█'],
  ['general-story', '閫氱敤鏁呬簨', '閫氱敤鍐欏疄椋庢牸'],
  ['food-v2', '缇庨鎺㈠簵V2', '鍩庡競琛楄灏忓簵鐨勭儫鐏皵'],
];

const styleOptions = [
  ['black-white', '榛戠櫧鎽勫奖', '绾疄鎰?],
  ['photo-real', '鍐欏疄褰╄壊', '璐ㄦ劅鑳剁墖'],
  ['oil-paint', '娌圭敾椋庢牸', '鍗拌薄鍐欐剰'],
  ['modern-film', '鐜颁唬鐢靛奖', '瀹藉睆璋冭壊'],
  ['ancient-film', '鍙ら鐢靛奖', '鍙や唬鍙茶瘲'],
  ['retro-film', '澶嶅彜鑳剁墖', '80骞翠唬琛楁媿'],
  ['watercolor', '姘村僵娌绘剤', '鏌斿拰鏅曟煋'],
  ['magazine', '鏉傚織鎻掔敾', '鏋佺畝鑹插潡'],
  ['pixar-3d', '鐨厠鏂?3D', '鍔ㄧ敾璐ㄦ劅'],
  ['ink', '涓浗姘村ⅷ', '鏂囦汉鎰忓'],
  ['folk', '姘戦棿鏁呬簨宸ョ瑪椋?, '宸ョ瑪鍙欎簨'],
  ['ghibli', '鍚夊崪鍔?, '娌绘剤鏃ユ极'],
];

const ratioOptions = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
const smartImageModeOptions: Array<[ImageLabSmartMode, string, string]> = [
  ['cover', '灏侀潰', '鐭棰戜富灏侀潰'],
  ['blog-cover', '鍗氬灏侀潰', '鏂囩珷棣栧浘 / 妯増涓诲浘'],
  ['podcast-cover', '鎾灏侀潰', '鑺傜洰鎰熷弻浜烘垨涓婚灏侀潰'],
  ['video-narration', '鏃佺櫧瑙嗛', '鍗曚汉璁茶堪涓昏瑙?],
  ['two-host-podcast', '鍙屼汉鎾', '涓や綅涓绘挱涓€闂竴绛?],
  ['reference-edit', '鍙傝€冨浘缂栬緫', '鍙傝€冨浘涓€鑷存€ф敼鍥?],
];
const storyboardSceneCountOptions = [8, 12, 16, 20, 30];
const siliconFlowSpeechToTextBaseUrl = 'https://api.siliconflow.cn/v1';
const siliconFlowSpeechToTextModels = ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'];
const volcengineVoicePresets = [
  ['Vivi 2.0', 'zh_female_vv_uranus_bigtts'],
  ['浜戣垷 2.0', 'zh_male_m191_uranus_bigtts'],
  ['鐖藉揩鎬濇€?2.0', 'zh_female_shuangkuaisisi_uranus_bigtts'],
  ['鍎掗泤闈掑勾 2.0', 'zh_male_ruyaqingnian_uranus_bigtts'],
  ['鎮枒瑙ｈ 2.0', 'zh_male_xuanyijieshuo_uranus_bigtts'],
] as const;
const pauseOptions: Array<[PausePoint, string]> = [
  ['none', '涓嶆殏鍋?],
  ['critical', '鍏抽敭鑺傜偣'],
  ['every-step', '姣忔纭'],
  ['custom', '鑷畾涔?],
];
const rewriteOptions: Array<[RewriteIntensity, string]> = [
  ['standard', '鏍囧噯鏀瑰啓'],
  ['deep', '娣卞害鏀瑰啓'],
  ['original', '楂樺害鍘熷垱'],
];
const povOptions = [
  ['keep-original', '淇濇寔鍘熸枃'],
  ['first-person', '绗竴浜虹О'],
  ['third-person', '绗笁浜虹О'],
] as const;
const promptTemplateTypeOptions: Array<PromptTemplateType | 'all'> = ['all', 'task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'];
const promptTemplateTypeLabels: Record<PromptTemplateType | 'all', string> = {
  all: '鍏ㄩ儴绫诲瀷',
  task: '浠诲姟妯℃澘',
  review: '棰勫鎻愮ず璇?,
  rewrite: '鏀瑰啓鎻愮ず璇?,
  cover: '灏侀潰鍏冩暟鎹彁绀鸿瘝',
  storyboard: '鍒嗛暅鎻愮ず璇?,
  'image-prompt': '鍑哄浘鎻愮ず璇?,
};
type PromptTemplateVariableScope = PromptTemplateType;
const promptTemplateVariableDefinitions = [
  { key: 'inputText', label: '鍘熸枃绱犳潗', description: '鏂板缓浠诲姟閲岀矘璐存垨瀵煎叆鐨勫師濮嬫枃妗?, scopes: ['task', 'review'] },
  { key: 'title', label: '浠诲姟鏍囬', description: '褰撳墠浠诲姟鏍囬鎴栬嚜鍔ㄧ敓鎴愭爣棰?, scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'sourceContext', label: '鑱旂綉璧勬枡', description: 'AI 鎼滅储鎴栫煡璇嗗簱甯﹀洖鏉ョ殑鍙傝€冭祫鏂?, scopes: ['review'] },
  { key: 'reviewedText', label: '棰勫缁撴灉', description: 'Step 0 娓呮礂銆佸幓閲嶅悗鐨勪簨瀹炵礌鏉?, scopes: ['rewrite', 'cover'] },
  { key: 'rewrittenCopy', label: '鏀瑰啓姝ｆ枃', description: 'Step 1 鏀瑰啓鍚庣殑鍙ｆ挱鏂囨', scopes: ['storyboard'] },
  { key: 'scenesJson', label: '鍒嗛暅鏁版嵁', description: 'Step 2 鎷嗗嚭鏉ョ殑鍒嗛暅 JSON', scopes: ['image-prompt'] },
  { key: 'track', label: '鍐呭璧涢亾', description: '浜虹墿鏁呬簨銆佸仴搴峰浘涔︺€佺數鍟嗙瓑璧涢亾', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'style', label: '鐢婚', description: '浠诲姟閫夋嫨鐨勫嚭鍥鹃鏍?, scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'ratio', label: '鐢婚潰姣斾緥', description: '9:16銆?6:9 绛夌敾甯冩瘮渚?, scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'extraRequirements', label: '棰濆瑕佹眰', description: '鏂板缓浠诲姟閲屽～鍐欑殑琛ュ厖瑕佹眰', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'rewriteIntensity', label: '鏀瑰啓寮哄害', description: '鏂板缓浠诲姟楂樼骇璁剧疆閲岀殑鏀瑰啓寮哄害', scopes: ['rewrite'] },
  { key: 'narrativePov', label: '鍙欎簨瑙嗚', description: '鏂板缓浠诲姟楂樼骇璁剧疆閲岀殑鍙欎簨瑙嗚', scopes: ['rewrite'] },
  { key: 'keepPromotion', label: '淇濈暀甯﹁揣', description: '鏂板缓浠诲姟楂樼骇璁剧疆閲岀殑甯﹁揣淇濈暀寮€鍏?, scopes: ['rewrite', 'cover'] },
  { key: 'aiKeyword', label: 'AI 鍏抽敭璇?, description: 'AI 鍒涗綔妯″紡閲岀殑妫€绱㈠叧閿瘝', scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'targetLength', label: '鐩爣瀛楁暟', description: '鏂板缓浠诲姟閲屽～鍐欑殑鍙ｆ挱鐩爣瀛楁暟', scopes: ['rewrite', 'storyboard'] },
  { key: 'storyboardSceneCount', label: '鐩爣鍒嗛暅鏁?, description: '鏂板缓浠诲姟閲屽～鍐欑殑鍒嗛暅鏁伴噺鐩爣', scopes: ['storyboard'] },
  { key: 'taskTemplateContent', label: '浠诲姟妯℃澘鎸囦护', description: '褰撳墠妯℃澘鐨勪换鍔℃€绘寚浠ゆ覆鏌撶粨鏋滐紱涓嶈鏀惧湪浠诲姟鎬绘寚浠ゅ唴', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'taskTemplateName', label: '浠诲姟妯℃澘鍚嶇О', description: '褰撳墠鏁呬簨妯℃澘鍚嶇О', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'defaultStyles', label: '榛樿鐢婚', description: '褰撳墠鏁呬簨妯℃澘缁戝畾鐨勯粯璁ゅ浘鍍忔ā鏉?, scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'defaultDraftTemplateId', label: '榛樿鑽夌妯℃澘', description: '褰撳墠鏁呬簨妯℃澘缁戝畾鐨勫壀鏄犺崏绋挎ā鏉?ID', scopes: ['task'] },
  { key: 'characterPolicy', label: '瑙掕壊妗ｆ绛栫暐', description: '褰撳墠鏁呬簨妯℃澘鏄惁寮哄埗鎻愬彇鎴栬烦杩囪鑹叉。妗?, scopes: ['task', 'image-prompt'] },
  { key: 'step3SkeletonModules', label: 'Step 3 楠ㄦ灦', description: '褰撳墠鏁呬簨妯℃澘鍚敤鐨勭粯鍥鹃鏋舵ā鍧?, scopes: ['storyboard', 'image-prompt'] },
  { key: 'referenceKind', label: '鍙傝€冨浘绫诲瀷', description: '褰撳墠鏁呬簨妯℃澘浣跨敤鐨勪汉鑴搞€佷骇鍝佹垨鏃犲弬鑰冨浘绫诲瀷', scopes: ['storyboard', 'image-prompt'] },
  { key: 'stylePrefix', label: '椋庢牸鍓嶇紑', description: '褰撳墠鍥惧儚妯℃澘鐨?prefix锛屼細娉ㄥ叆 Step 3 鍑哄浘鎻愮ず璇?, scopes: ['image-prompt'] },
  { key: 'styleSuffix', label: '椋庢牸鍚庣紑', description: '褰撳墠鍥惧儚妯℃澘鐨?suffix锛屼細娉ㄥ叆 Step 3 鍑哄浘鎻愮ず璇?, scopes: ['image-prompt'] },
  { key: 'styleAllowColor', label: '鍏佽鑹插僵璇?, description: '褰撳墠鍥惧儚妯℃澘鏄惁鍏佽鍦ㄧ敾闈㈤噷浣跨敤鍏蜂綋鑹插僵璇?, scopes: ['image-prompt'] },
  { key: 'styleNegativePrompt', label: '璐熼潰鎻愮ず璇?, description: '褰撳墠鍥惧儚妯℃澘鐨?negative prompt', scopes: ['image-prompt'] },
  { key: 'referenceImagePath', label: '鍙傝€冨浘璺緞', description: '鏂板缓浠诲姟涓婁紶鎴栧～鍐欑殑鍙傝€冨浘鏈湴璺緞', scopes: ['image-prompt'] },
  { key: 'imagePromptReference', label: '鐢熷浘鍙傝€?, description: '鐖嗘鎷嗚В鎴栫敤鎴疯ˉ鍏呯殑鐢婚潰鍙傝€冩彁绀?, scopes: ['image-prompt'] },
  { key: 'characterCard', label: '瑙掕壊妗ｆ', description: 'Step 3 鍓嶆彁鍙栧嚭鐨勮鑹蹭竴鑷存€?JSON', scopes: ['image-prompt'] },
  { key: 'imageSeedPoolsJson', label: '鍥剧墖绉嶅瓙姹?, description: '褰撳墠鏁呬簨妯℃澘鎼哄甫鐨?StoryDream 鍥剧墖绉嶅瓙姹?JSON', scopes: ['image-prompt'] },
] satisfies Array<{ key: string; label: string; description: string; scopes: PromptTemplateVariableScope[] }>;
const promptTemplateVariables = promptTemplateVariableDefinitions.map((item) => item.key);
const promptStepEditorDefinitions: Array<{ type: PromptStepTemplateType; label: string; hint: string }> = [
  { type: 'review', label: 'Step 0 棰勫', hint: '娓呯悊杈撳叆绱犳潗銆佷繚鐣欎簨瀹為『搴忋€佸幓鎺夐噸澶嶈〃杈? },
  { type: 'rewrite', label: 'Step 1 鏀瑰啓', hint: '鎺у埗鍙ｆ挱鏂囨鐨勮瑷€銆佽妭濂忓拰缁撴瀯' },
  { type: 'cover', label: 'Step 1 鍏冩暟鎹?, hint: '鐢熸垚鏍囬銆佹憳瑕併€佹爣绛惧拰璇勮鐨勮鍒? },
  { type: 'storyboard', label: 'Step 2 鍒嗛暅', hint: '鎺у埗鍒嗛暅鎷嗗彞銆侀暅澶磋妭濂忓拰鍦烘櫙鏁伴噺' },
  { type: 'image-prompt', label: 'Step 3 鍑哄浘', hint: '鎺у埗鍑哄浘鎻愮ず璇嶃€佽鑹蹭竴鑷存€у拰瀹夊叏瑙勫垯' },
];
const promptTemplateStep3SkeletonOptions = ['璺ㄥ勾浠?, '闃插彴璇嶆枃瀛?, '浜у搧涓€鑷存€?];
const promptTemplateReferenceOptions: Array<[NonNullable<PromptTemplate['referenceKind']>, string]> = [
  ['none', '鏃?],
  ['face', '浜鸿劯'],
  ['product', '浜у搧'],
];
const bundledDraftTemplateOptionIds = new Set<string>(
  ((feishuCozeDraftTemplateBundle as { templates?: Array<{ id?: string }> }).templates ?? [])
    .map((template) => template.id)
    .filter((id): id is string => Boolean(id)),
);
const fallbackEffectCatalog: JianyingEffectCatalog = {
  status: 'warn',
  detail: '鏈鍙栧埌鍓槧鐗规晥鐩綍锛屽凡浣跨敤鏈湴鍩虹杞満娓呭崟銆?,
  transitions: ['鍙犲寲'],
  filters: [],
  videoEffects: [],
  audioEffects: [],
};

const pipelineSteps = [
  { index: 0, title: 'Step 0 棰勫', hint: '娓呯悊骞垮憡銆侀噸澶嶅拰鏁忔劅琛ㄨ揪', agent: 'Reviewer' },
  { index: 1, title: 'Step 1 涓夎疆鏀瑰啓鑷瘎', hint: '涓夎疆鏀瑰啓銆佽瘎鍒嗐€佽嚜璇勫苟鐢熸垚灏侀潰淇℃伅', agent: 'Writer' },
  { index: 2, title: 'Step 2 鍒嗛暅', hint: '鎷嗘垚鍙厤鍥剧殑闀滃ご鍗曞厓', agent: 'Storyboard' },
  { index: 3, title: 'Step 3 涓昏妗ｆ涓庡嚭鍥炬彁绀鸿瘝', hint: '鎻愬彇瑙掕壊妗ｆ骞剁敓鎴愭瘡闀?prompt', agent: 'Prompt' },
  { index: 4, title: 'Step 4 鎵归噺鐢熷浘', hint: '骞跺彂璋冪敤 AI 缁樺浘锛屾殏鍋滃悗鍙画璺?, agent: 'Producer' },
  { index: 5, title: 'Step 5 閰嶉煶', hint: '鐢熸垚鏃佺櫧闊抽鍜屽瓧骞曟椂闂磋酱', agent: 'TTS' },
  { index: 6, title: 'Step 6 鑽夌瀵煎嚭', hint: '鍐欏叆鍓槧鑽夌杈撳嚭鐩綍', agent: 'Draft' },
] as const;

type StoryDreamApi = NonNullable<Window['storydream']>;
type ModelListKey = 'llm' | 'gpt-image' | 'custom-image';
type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';
const DRAFT_TEXT_WIDTH_MIN = 0.1;
const DRAFT_TEXT_WIDTH_MAX = 2;
type DraftDragSnapshot =
  | { mode: 'move'; layer: DraftCanvasLayer; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize'; layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate };

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function hydrateState(state: Partial<AppState>): AppState {
  return {
    ...cloneState(initialState),
    ...state,
    config: normalizeAppConfig(state.config ?? defaultConfig),
    tasks: state.tasks ?? [],
    events: state.events ?? [],
    promptTemplates: state.promptTemplates ?? defaultPromptTemplates,
    draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate),
    imageLabRecords: state.imageLabRecords ?? [],
    voiceLabRecords: state.voiceLabRecords ?? [],
    customStyles: mergeDefaultCustomStyles(state.customStyles),
    customCoverTemplates: state.customCoverTemplates ?? defaultCustomCoverTemplates,
    creditTransactions: state.creditTransactions ?? defaultCreditTransactions,
    minimaxCloneVoices: state.minimaxCloneVoices ?? [],
    account: { ...defaultAccount, ...(state.account ?? {}) },
    activation: { ...defaultActivation, ...(state.activation ?? {}) },
    ui: { ...defaultUiPreferences, ...(state.ui ?? {}) },
  };
}

function mergeDefaultCustomStyles(styles: CustomStyle[] | undefined): CustomStyle[] {
  const current = new Map((styles ?? []).map((style) => [style.id, style]));
  const builtinIds = new Set(defaultCustomStyles.map((style) => style.id));
  return [
    ...defaultCustomStyles.map((style) => current.get(style.id) ?? style),
    ...(styles ?? []).filter((style) => !builtinIds.has(style.id)),
  ];
}

function makeFallbackApi(setState: (state: AppState) => void): StoryDreamApi {
  const read = () => {
    const raw = localStorage.getItem('storydream-state') ?? localStorage.getItem('storybound-state');
    return raw ? hydrateState(JSON.parse(raw) as AppState) : cloneState(initialState);
  };
  const persist = (state: AppState) => {
    const next = hydrateState(state);
    localStorage.setItem('storydream-state', JSON.stringify(next));
    setState(next);
    return next;
  };

  return {
    async getState() {
      return read();
    },
    async saveConfig(config: AppConfig) {
      return persist({ ...read(), config });
    },
    async testLlmConfig(config) {
      return {
        status: config.apiKey ? 'warn' : 'fail',
        detail: config.apiKey ? '娴忚鍣ㄩ瑙堟棤娉曡皟鐢ㄦā鍨嬫祴璇曟帴鍙ｏ紝璇峰湪 Electron 妗岄潰绔祴璇曘€? : '鎺ュ彛瀵嗛挜鏈～鍐欙紝璇峰厛琛ュ叏妯″瀷鍑瘉銆?,
        latencyMs: 0,
        model: config.model,
        endpoint: `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`,
        requestId: null,
      };
    },
    async listProviderModels(request) {
      return listOpenAiCompatibleModels(request);
    },
    async listVolcengineSpeakers() {
      const speakers = volcengineVoicePresets.map(([name, voiceType]) => ({ voiceType, name }));
      return {
        status: 'warn',
        detail: '娴忚鍣ㄩ瑙堟棤娉曡皟鐢ㄧ伀灞?OpenAPI锛屽凡灞曠ず鏈湴棰勮闊宠壊銆傝鍦?Electron 妗岄潰绔姞杞藉叏閮ㄩ煶鑹层€?,
        latencyMs: 0,
        endpoint: 'https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20',
        speakers,
        total: speakers.length,
        requestId: null,
      };
    },
    async testAppConfig(target, config) {
      return validateConfigTarget(target, config);
    },
    async searchWebSources(query) {
      return {
        query,
        sections: [],
        warnings: ['娴忚鍣ㄩ瑙堟棤娉曠洿鎺ユ姄鍙栫綉椤垫鏂囷紝璇峰湪 Electron 妗岄潰绔娇鐢ㄦ悳绱€?],
      };
    },
    async composeResearchCopy() {
      throw new Error('娴忚鍣ㄩ瑙堟棤娉曡皟鐢ㄧ湡瀹?LLM 鐢熸垚鏂囨锛岃鍦?Electron 妗岄潰绔厤缃ā鍨嬪悗浣跨敤銆?);
    },
    async savePromptTemplate(template: PromptTemplate) {
      const state = read();
      const next = state.promptTemplates.filter((item) => item.id !== template.id);
      return persist({ ...state, promptTemplates: [{ ...template, updatedAt: new Date().toISOString() }, ...next] });
    },
    async resetPromptTemplates() {
      const state = read();
      const custom = state.promptTemplates.filter((template) => !template.isBuiltin);
      return persist({ ...state, promptTemplates: [...defaultPromptTemplates, ...custom] });
    },
    async saveCustomStyle(style: CustomStyle) {
      const state = read();
      const next = state.customStyles.filter((item) => item.id !== style.id);
      const now = new Date().toISOString();
      return persist({ ...state, customStyles: [{ ...style, updatedAt: now, createdAt: style.createdAt || now }, ...next] });
    },
    async generateCustomStyleDraft(input) {
      return { ...input.baseStyle, ...buildImageStyleDraftFromPrompt(input.prompt, input.baseStyle) };
    },
    async saveDraftTemplate(template: DraftTemplate) {
      const state = read();
      const exists = state.draftTemplates.some((item) => item.id === template.id);
      const templates = exists ? state.draftTemplates.map((item) => (item.id === template.id ? template : item)) : [template, ...state.draftTemplates];
      return persist({ ...state, draftTemplates: templates });
    },
    async generateImageLab(input: ImageLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: state.config.imageProvider,
        imagePath: '',
        status: 'failed',
        errorMessage: '娴忚鍣ㄩ瑙堟棤娉曡皟鐢ㄧ湡瀹炵敓鍥炬ā鍨嬶紝璇峰湪 Electron 妗岄潰绔娇鐢ㄣ€?,
        resolution: input.resolution ?? activeImageResolution(state.config),
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths?.length ? input.referenceImagePaths : input.referenceImagePath ? [input.referenceImagePath] : [],
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async generateVoiceLabPreview(input: VoiceLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: VoiceLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        text: input.text,
        provider: input.provider,
        voiceId: input.voiceId,
        voiceLabel: input.voiceLabel ?? taskSpeakerLabel(input.provider, input.voiceId),
        speed: input.speed,
        audioPath: '',
        status: 'failed',
        errorMessage: '娴忚鍣ㄩ瑙堜笉鑳借皟鐢ㄧ湡瀹?TTS锛岃鍦?Electron 妗岄潰绔敓鎴愯瘯鍚€?,
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, voiceLabRecords: [record, ...state.voiceLabRecords] });
    },
    async addImageLabRecord(input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: input.provider,
        imagePath: input.imagePath ?? '',
        status: input.status ?? 'failed',
        errorMessage: input.errorMessage ?? '',
        resolution: input.resolution ?? '2K',
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths?.length ? input.referenceImagePaths : input.referenceImagePath ? [input.referenceImagePath] : [],
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: input.finishedAt ?? now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async saveAccount(account: AccountProfile) {
      return persist({ ...read(), account });
    },
    async saveActivation(activation: ActivationState) {
      return persist({ ...read(), activation });
    },
    async saveUiPreferences(ui: UiPreferences) {
      return persist({ ...read(), ui });
    },
    async createAndRunTask(input: CreateTaskInput) {
      const browserPipelineError =
        '娴忚鍣ㄩ瑙堟棤娉曡繍琛岀湡瀹炰緵搴斿晢娴佹按绾裤€傝鍦?Electron 妗岄潰绔厤缃?LLM銆佺敓鍥俱€乀TS銆丳ython 鍜?pyJianYingDraft 鍚庢墽琛屻€?;
      const state = read();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'New task',
        inputText: input.inputText,
        taskKind: input.taskKind ?? 'story',
        processingMode: input.processingMode ?? 'full-auto',
        publishMode: input.publishMode ?? 'review-rewrite',
        status: 'paused',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'photo-real',
        speaker: input.speaker ?? '鐏垮崥灏忓彅',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: browserPipelineError,
        createdAt: new Date().toISOString(),
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        imagePromptReference: input.imagePromptReference ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.storyboardSceneCount ?? 12,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        musicMv: input.musicMv ?? { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
        videoForm: input.videoForm ?? 'narration',
        failedStep: 0,
        retryFromStep: 0,
        artifactStatePath: '',
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'step_error', step: 0, agent: 'Reviewer', tool: null, detail: browserPipelineError, dataJson: null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async createAndRunViralAnalysis(input: CreateViralAnalysisInput) {
      const state = read();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      return persist({
        ...state,
        viralAnalyses: [
          {
            id,
            url: input.url,
            platform: input.platform ?? detectBrowserViralPlatform(input.url),
            title: input.title ?? input.url,
            status: 'paused',
            currentStage: 'failed',
            progress: 0,
            settings: input.settings,
            resultPath: '',
            videoPath: '',
            errorMessage: '娴忚鍣ㄩ瑙堟棤娉曡繍琛岀垎娆捐棰戞媶瑙ｃ€傝鍦?Electron 妗岄潰绔笅杞藉苟澶勭悊瑙嗛銆?,
            createdAt: now,
            startedAt: now,
            completedAt: null,
            lastHeartbeatAt: now,
          },
          ...state.viralAnalyses,
        ],
        viralEvents: [
          ...state.viralEvents,
          {
            analysisId: id,
            type: 'error',
            stage: 'failed',
            detail: '娴忚鍣ㄩ瑙堟棤娉曡繍琛岀垎娆捐棰戞媶瑙ｃ€傝鍦?Electron 妗岄潰绔笅杞藉苟澶勭悊瑙嗛銆?,
            dataJson: null,
            ts: Date.now(),
          },
        ],
      });
    },
    async updateViralAnalysisStatus(id: string, status: ViralAnalysisStatus) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status } : item)) });
    },
    async retryViralAnalysis(id: string) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status: 'pending', errorMessage: '' } : item)) });
    },
    async getViralAnalysisResult(id: string): Promise<ViralAnalysisResult> {
      const state = read();
      const record = state.viralAnalyses.find((item) => item.id === id);
      throw new Error(`娴忚鍣ㄩ瑙堟棤娉曡鍙栫垎娆炬媶瑙ｇ粨鏋滐細${record?.title ?? id}`);
    },
    async createProductionTaskFromViral(id: string) {
      throw new Error(`娴忚鍣ㄩ瑙堟棤娉曚粠鐖嗘鎷嗚В鍒涘缓鎴愮墖浠诲姟锛?{id}`);
    },
    async updateTaskStatus(id: string, status: TaskStatus) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status, errorMessage: status === 'cancelled' ? '鐢ㄦ埛鍙栨秷' : task.errorMessage } : task)) });
    },
    async retryTask(id: string) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status: 'pending', errorMessage: '' } : task)) });
    },
    async regenerateTaskImage() {
      throw new Error('娴忚鍣ㄩ瑙堜笉鑳介噸鏂扮敓鎴愮湡瀹炲浘鐗囷紝璇峰湪 Electron 搴旂敤涓搷浣溿€?);
    },
    async regenerateTaskNarration() {
      throw new Error('娴忚鍣ㄩ瑙堜笉鑳介噸鏂扮敓鎴愮湡瀹為厤闊筹紝璇峰湪 Electron 搴旂敤涓搷浣溿€?);
    },
    async rerunTaskStep() {
      throw new Error('娴忚鍣ㄩ瑙堜笉鑳介噸鏂版墽琛岀湡瀹炴祦姘寸嚎姝ラ锛岃鍦?Electron 搴旂敤涓搷浣溿€?);
    },
    async getTaskArtifacts(id: string) {
      const task = read().tasks.find((item) => item.id === id);
      return {
        available: false,
        message: '娴忚鍣ㄩ瑙堟棤娉曡鍙栨湰鍦颁换鍔′骇鐗╋紝璇峰湪 Electron 妗岄潰绔煡鐪嬨€?,
        taskId: id,
        statePath: task?.artifactStatePath ?? '',
        outputDir: task?.outputDir ?? '',
        updatedAt: null,
        steps: {},
        artifact: {},
        assets: { cover: [], images: [], narration: [] },
        draft: null,
      };
    },
    async readAssetDataUrl() {
      throw new Error('娴忚鍣ㄩ瑙堜笉鑳借鍙栨湰鍦板獟浣撻瑙堬紝璇峰湪 Electron 搴旂敤涓煡鐪嬨€?);
    },
    async selectLocalImage() {
      return null;
    },
    async selectLocalAudio() {
      return null;
    },
    async selectLocalFolder() {
      return null;
    },
    async selectCookieFile() {
      return null;
    },
    async openViralLoginWindow() {
      throw new Error('娴忚鍣ㄩ瑙堜笉鑳芥墦寮€鎶栭煶鐧诲綍绐楀彛锛岃鍦?Electron 妗岄潰绔搷浣溿€?);
    },
    async detectJianyingDraftPath() {
      return '';
    },
    async getJianyingEffectCatalog() {
      return fallbackEffectCatalog;
    },
    async runDiagnostics() {
      const state = read();
      return {
        generatedAt: new Date().toISOString(),
        checks: [
          { id: 'llm-config', label: 'LLM 閰嶇疆瀹屾暣鎬?, status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
          { id: 'tts-config', label: 'TTS 鍑瘉宸插～鍐?, status: state.config.tts.volcengine.apiKey || state.config.tts.accessKey ? 'pass' : 'warn', detail: state.config.tts.provider },
          { id: 'jianying-sidecar', label: '鍓槧鑽夌鐩綍', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath },
          { id: 'account-state', label: '璐︽埛鐘舵€?, status: 'pass', detail: state.activation.message },
        ],
      };
    },
    openPath: async () => undefined,
    windowControl: async () => undefined,
    onTaskEvent: () => () => undefined,
  };
}

function App() {
  const [state, setState] = useState<AppState>(cloneState(initialState));
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storydream && !window.storybound;
  const api = useMemo(() => window.storydream ?? window.storybound ?? makeFallbackApi(setState), []);

  useEffect(() => {
    api
      .getState()
      .then((next) => {
        const hydrated = hydrateState(next);
        setState(hydrated);
        setActiveView(hydrated.ui.activeView);
      })
      .catch(console.error);
    return api.onTaskEvent((next) => {
      setState(hydrateState(next));
    });
  }, [api]);

  const liveRefreshMs = state.tasks.some((task) => task.status === 'running' || task.status === 'pending') ? 1000 : 0;
  useEffect(() => {
    if (!liveRefreshMs) return undefined;
    const timer = window.setInterval(() => {
      api.getState().then((next) => setState(hydrateState(next))).catch(console.error);
    }, liveRefreshMs);
    return () => window.clearInterval(timer);
  }, [api, liveRefreshMs]);

  async function navigate(view: ShellView) {
    if (view !== 'task-detail') {
      setSelectedTaskId(null);
    }
    setActiveView(view);
    setSaveTone('saving');
    try {
      const next = await api.saveUiPreferences({ ...state.ui, activeView: view });
      setState(hydrateState(next));
      setSaveTone('saved');
    } catch (error) {
      setSaveTone('dirty');
      console.error(error);
    }
  }

  function applyState(next: AppState) {
    setState(hydrateState(next));
    setSaveTone('saved');
  }

  async function openTaskDetail(taskId: string) {
    setSelectedTaskId(taskId);
    setActiveView('task-detail');
    setSaveTone('saving');
    try {
      const next = await api.saveUiPreferences({ ...state.ui, activeView: 'task-detail' });
      setState(hydrateState(next));
      setSaveTone('saved');
    } catch (error) {
      setSaveTone('dirty');
      console.error(error);
    }
  }

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? state.tasks[0] ?? null;
  const recentTasks = state.tasks.slice(0, 3);
  const trialDaysLabel = state.activation.expiresAt
    ? `${Math.max(0, Math.ceil((new Date(state.activation.expiresAt).getTime() - Date.now()) / 86400000))} 澶ー
    : '鏈湴璇曠敤';
  const activeNav = activeView === 'task-detail' ? { label: '浠诲姟璇︽儏', hint: '鍗曚换鍔℃祦姘寸嚎' } : navItems.find((item) => item.view === activeView) ?? navItems[0];

  return (
    <main className="app-shell">
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>StoryDream</strong>
        </div>
        <div className="window-controls" aria-label="绐椾綋鎺у埗">
          <button className="window-control-button" type="button" aria-label="鏈€灏忓寲" onClick={() => api.windowControl('minimize')}>
            <Minus size={14} />
          </button>
          <button className="window-control-button" type="button" aria-label="鏈€澶у寲" onClick={() => api.windowControl('toggle-maximize')}>
            <Maximize2 size={14} />
          </button>
          <button className="window-control-button close" type="button" aria-label="鍏抽棴" onClick={() => api.windowControl('close')}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>StoryDream</strong>
              <span>v0.10.4 路 beta</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <button className="new-task-button" onClick={() => navigate('new-task')}>
            <Plus size={16} />
            <span>鏂板缓浠诲姟</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <nav className="nav-list">
            <span className="nav-section-label">涓荤嚎宸ヤ綔娴?/span>
            {primaryNavItems.filter((item) => item.view !== 'new-task').map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
            <span className="nav-section-label secondary">鎵╁睍宸ュ叿</span>
            {secondaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
          </nav>

          <div className="sidebar-bottom">
            <section className="recent-task-strip">
              <span className="nav-section-label">鏈€杩戜换鍔?/span>
              {recentTasks.length === 0 ? <small>鏆傛棤浠诲姟</small> : null}
              {recentTasks.map((task) => (
                <button key={task.id} className="recent-task-item" onClick={() => openTaskDetail(task.id)}>
                  <strong>{task.title || '鏈懡鍚嶄换鍔?}</strong>
                  <span>{statusLabel(task.status)} 路 Step {Math.min(task.currentStep, 6)}</span>
                </button>
              ))}
            </section>
            <button className="trial-activation-bar" onClick={() => navigate('activation')}>
              <KeyRound size={15} />
              <span>璇曠敤鍓╀綑</span>
              <strong>{trialDaysLabel}</strong>
            </button>
            <div className="account-entry-grid">
              <button className="credit-chip" onClick={() => navigate('account')}>
                <Coins size={15} />
                绉垎鏄庣粏
                <span>{state.account.balance.toFixed(2)}</span>
              </button>
              <button className="feedback-link" onClick={() => navigate('account')}>
                <Info size={14} />
                璐︽埛涓績
              </button>
            </div>
          </div>
        </aside>

        <section className="content">
          <header className="page-head">
          <div>
            <h1>{activeNav.label}</h1>
            <p>{pageSubtitle(activeView)}</p>
            {isBrowserPreview ? <span className="local-note">娴忚鍣ㄩ瑙堜笉鑳芥墽琛岀湡瀹炴祦姘寸嚎锛岃鍦?Electron 搴旂敤涓繍琛屼换鍔°€?/span> : null}
          </div>
            <div className="top-notice">
              <Info size={16} />
              <span>{state.config.jianying.draftPath ? `鍓槧鑽夌鐩綍锛?{state.config.jianying.draftPath}` : '灏氭湭閰嶉綈锛氬壀鏄犺崏绋跨洰褰?}</span>
            </div>
            <div className={`save-state ${saveTone}`}>
              <span />
              {saveTone === 'saving' ? '淇濆瓨涓? : saveTone === 'dirty' ? '鏈夋湭淇濆瓨鏀瑰姩' : '鎵€鏈夋敼鍔ㄥ凡淇濆瓨'}
            </div>
          </header>

          {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'history' ? <HistoryPage api={api} state={state} openTaskDetail={openTaskDetail} /> : null}
          {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'voice-lab' ? <VoiceLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'viral-analyzer' ? <ViralAnalyzerPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
        </section>
      </div>
    </main>
  );
}

function NavButton({ item, active, navigate }: { item: NavItem; active: boolean; navigate: (view: ShellView) => void }) {
  const Icon = item.icon;
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.view)}>
      <Icon size={16} />
      <span>{item.label}</span>
      <small>{item.hint}</small>
    </button>
  );
}

type ViralSourceMode = 'auto' | 'douyin' | 'kuaishou' | 'bilibili';
const viralSourceModes: ViralSourceMode[] = ['auto', 'douyin', 'kuaishou', 'bilibili'];

function ViralAnalyzerPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<ViralSourceMode>('auto');
  const [track, setTrack] = useState('ecommerce');
  const [style, setStyle] = useState('photo-real');
  const [ratio, setRatio] = useState('9:16');
  const [templateId, setTemplateId] = useState('default-portrait-9-16');
  const [keyFrameCount, setKeyFrameCount] = useState(8);
  const [cookieFilePath, setCookieFilePath] = useState(state.config.viral.cookieFilePath);
  const [selectedId, setSelectedId] = useState(state.viralAnalyses[0]?.id ?? '');
  const [result, setResult] = useState<ViralAnalysisResult | null>(null);
  const [message, setMessage] = useState('');
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const selected = state.viralAnalyses.find((item) => item.id === selectedId) ?? state.viralAnalyses[0] ?? null;
  const selectedEvents = selected ? state.viralEvents.filter((event) => event.analysisId === selected.id) : [];
  const detectedPlatform = detectBrowserViralPlatform(url);
  const selectedPlatformForAnalysis: ViralPlatform = sourceMode === 'auto' ? detectedPlatform : sourceMode;
  const selectedStageIndex = selected ? viralStages.indexOf(selected.currentStage) : -1;

  useEffect(() => {
    if (!selectedId && state.viralAnalyses[0]) setSelectedId(state.viralAnalyses[0].id);
  }, [selectedId, state.viralAnalyses]);

  useEffect(() => {
    let cancelled = false;
    if (!selected || selected.status !== 'completed') {
      setResult(null);
      return;
    }
    api.getViralAnalysisResult(selected.id)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [api, selected?.id, selected?.status]);

  function handleUrlChange(value: string) {
    setUrl(value);
  }

  async function saveViralCookiePath(path: string) {
    const trimmed = path.trim();
    setCookieFilePath(trimmed);
    const nextState = await api.saveConfig({
      ...state.config,
      viral: {
        ...state.config.viral,
        cookieFilePath: trimmed,
      },
    });
    applyState(nextState);
  }

  async function chooseCookieFile() {
    const selectedPath = await api.selectCookieFile();
    if (selectedPath) {
      await saveViralCookiePath(selectedPath);
    }
  }

  async function openDouyinLogin() {
    setMessage('璇峰湪鎵撳紑鐨勬姈闊崇獥鍙ｅ畬鎴愮櫥褰曪紝鍏抽棴绐楀彛鍚庝細鑷姩淇濆瓨 Cookie銆?);
    const loginCookiePath = await api.openViralLoginWindow();
    if (loginCookiePath) {
      setCookieFilePath(loginCookiePath);
      setMessage(`宸蹭繚瀛?Cookie 鏂囦欢锛?{loginCookiePath}`);
    }
  }

  async function startAnalysis() {
    if (!url.trim()) {
      setMessage('璇疯緭鍏ユ姈闊炽€佸揩鎵嬫垨 B 绔欏叕寮€瑙嗛閾炬帴');
      return;
    }
    if (selectedPlatformForAnalysis === 'unknown') {
      setMessage('鏈瘑鍒埌骞冲彴锛岃閫夋嫨鎶栭煶銆佸揩鎵嬫垨 B绔欍€?);
      return;
    }
    setMessage('');
    setStartingAnalysis(true);
    try {
      if (cookieFilePath !== state.config.viral.cookieFilePath) await saveViralCookiePath(cookieFilePath);
      const next = await api.createAndRunViralAnalysis({
        url: url.trim(),
        platform: selectedPlatformForAnalysis,
        settings: { track, style, ratio, templateId, keyFrameCount, storyboardSceneCount: 12 },
      });
      applyState(next);
      setSelectedId(next.viralAnalyses[0]?.id ?? '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingAnalysis(false);
    }
  }

  async function createProductionTask() {
    if (!selected) return;
    const next = await api.createProductionTaskFromViral(selected.id, {
      track,
      style,
      ratio,
      templateId,
      storyboardSceneCount: result?.recreation.taskDefaults.storyboardSceneCount ?? 12,
    });
    applyState(next);
    if (next.tasks[0]) openTaskDetail(next.tasks[0].id);
  }

  async function saveViralTemplates(input: { storyTemplateName: string; imageTemplateName: string }) {
    if (!result) return;
    const drafts = createViralTemplateDrafts(result, {
      storyTemplateName: input.storyTemplateName,
      imageTemplateName: input.imageTemplateName,
      track,
      style,
      draftTemplateId: templateId,
    });
    await api.saveCustomStyle(drafts.imageTemplate);
    const next = await api.savePromptTemplate(drafts.storyTemplate);
    applyState(next);
    setMessage('宸蹭繚瀛樻晠浜嬫ā鏉垮拰鍥剧墖妯℃澘锛屽彲鍦ㄦ彁绀鸿瘝妯℃澘涓户缁紪杈戙€?);
  }

  return (
    <div className="viral-analyzer-layout">
      <div className="viral-workbench">
        <section className="panel viral-input-panel">
          <div className="panel-title-row">
            <div>
              <h2>鐖嗘鎷嗚В</h2>
              <p>鏀寔鎶栭煶銆佸揩鎵嬨€丅绔欓摼鎺ワ紝鎷嗚В寮€澶淬€佺粨鏋勩€佺粨灏俱€佺垎鐐广€?/p>
            </div>
            <Flame size={20} />
          </div>
          <label className="field-label" htmlFor="viral-url-input">瑙嗛閾炬帴</label>
          <input id="viral-url-input" className="text-input viral-url-input" value={url} onChange={(event) => handleUrlChange(event.target.value)} placeholder="https://www.douyin.com/video/..." />
          <div className="segmented viral-platform-picker">
            {viralSourceModes.map((item) => (
              <button key={item} type="button" className={sourceMode === item ? 'active' : ''} onClick={() => setSourceMode(item)}>
                {viralSourceModeLabel(item)}
              </button>
            ))}
          </div>
          <p className="viral-source-status">
            {sourceMode === 'auto' ? `鑷姩璇嗗埆锛?{viralPlatformLabel(detectedPlatform)}` : `鎵嬪姩鎸囧畾锛?{viralPlatformLabel(selectedPlatformForAnalysis)}`}
          </p>
          <button className="primary-action viral-start-action" disabled={startingAnalysis || (isBrowserPreview && false)} onClick={startAnalysis}>
            <Search size={16} />
            {startingAnalysis ? '姝ｅ湪鍒涘缓鎷嗚В...' : '寮€濮嬫媶瑙?}
          </button>
          <div className="viral-settings-grid">
            <Field label="鍏抽敭甯ф暟閲?>
              <input
                className="text-input"
                type="number"
                min={1}
                max={40}
                step={1}
                value={keyFrameCount}
                onChange={(event) => setKeyFrameCount(normalizeViralKeyFrameCount(event.target.value))}
              />
            </Field>
            <ViralChoiceGroup title="璧涢亾" options={contentTracks} value={track} onChange={setTrack} />
            <ViralChoiceGroup title="椋庢牸" options={styleOptions} value={style} onChange={setStyle} />
            <ViralChoiceGroup title="姣斾緥" options={ratioOptions.map((item) => [item, item, ''])} value={ratio} onChange={setRatio} compact />
            <Field label="鑽夌妯℃澘">
              <select className="viral-draft-template-select" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {state.draftTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} 路 {template.canvas.ratio}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="viral-cookie-tools">
            <div className="settings-inline-actions">
              <button className="mini-button" type="button" onClick={openDouyinLogin}>鎵撳紑鎶栭煶鐧诲綍绐楀彛</button>
              <button className="mini-button" type="button" onClick={chooseCookieFile}>閫夋嫨 Cookie 鏂囦欢</button>
            </div>
            <Field label="Cookie 鏂囦欢">
              <div className="viral-cookie-input-row">
                <input
                  id="viral-cookie-input"
                  className="text-input"
                  value={cookieFilePath}
                  onChange={(event) => setCookieFilePath(event.target.value)}
                  onBlur={() => saveViralCookiePath(cookieFilePath)}
                  placeholder="C:\\Users\\you\\Downloads\\cookies.txt"
                />
                {cookieFilePath ? <button className="mini-button" type="button" onClick={() => saveViralCookiePath('')}>娓呯┖</button> : null}
              </div>
            </Field>
            <p className="muted-text">鎶栭煶椋庢帶鏃跺厛鐐圭櫥褰曠獥鍙ｅ畬鎴愮櫥褰曪紱鍏抽棴绐楀彛鍚庝細鑷姩鍐欏叆鏈簲鐢ㄧ殑 Cookie 鏂囦欢銆備篃鍙互鎵嬪姩閫夋嫨 Netscape cookies.txt銆?/p>
          </div>
          {message ? <div className="test-result">{message}</div> : null}
        </section>

        <section className="panel viral-history-panel">
          <div className="panel-title-row">
            <h3>鍘嗗彶鎷嗚В</h3>
            <span className="panel-count">{state.viralAnalyses.length}</span>
          </div>
          <div className="viral-history-list">
            {state.viralAnalyses.map((item) => (
              <button key={item.id} title={item.title || item.url} className={selected?.id === item.id ? 'viral-history-item active' : 'viral-history-item'} onClick={() => setSelectedId(item.id)}>
                <strong>{item.title || item.url}</strong>
                <span>{viralPlatformLabel(item.platform)} 路 {viralStatusLabel(item.status)} 路 {(item.progress * 100).toFixed(0)}%</span>
              </button>
            ))}
            {state.viralAnalyses.length === 0 ? <p className="muted-text">鏆傛棤鎷嗚В浠诲姟</p> : null}
          </div>
        </section>
      </div>

      <section className="panel viral-progress-panel">
        <h3>浠诲姟杩涘害</h3>
        <div className="viral-progress-list viral-stage-timeline">
          {viralStages.map((stage, stageIndex) => {
            const isActive = selected?.currentStage === stage;
            const isCompleted = selected?.status === 'completed' || (selectedStageIndex > stageIndex && selectedStageIndex !== -1);
            const isFailed = selected?.status === 'failed' && isActive;
            const className = ['viral-progress-step', 'viral-stage-node', isActive ? 'active' : '', isCompleted ? 'completed' : '', isFailed ? 'failed' : ''].filter(Boolean).join(' ');
            const latestEvent = latestViralEventForStage(selectedEvents, stage);
            return (
              <div key={stage} className={className}>
                <span>{viralStageLabel(stage)}</span>
                <small>{latestEvent?.detail ?? '绛夊緟涓?}</small>
              </div>
            );
          })}
        </div>
        {selected?.errorMessage ? <ErrorSummaryButton title="鎷嗚В閿欒" fullMessage={selected.errorMessage} /> : null}
      </section>

      <section className="panel viral-report-panel viral-result-drawer">
        <div className="panel-title-row">
          <h3>鎷嗚В鎶ュ憡</h3>
          {selected?.status === 'failed' || selected?.status === 'cancelled' ? <button className="mini-button viral-retry-button" type="button" onClick={() => selected && api.retryViralAnalysis(selected.id).then(applyState)}><RotateCcw size={14} />閲嶈瘯</button> : null}
        </div>
        {result ? <ViralReport result={result} createProductionTask={createProductionTask} saveTemplates={saveViralTemplates} track={track} style={style} draftTemplateId={templateId} /> : <p className="muted-text">浠诲姟瀹屾垚鍚庢樉绀哄紑澶淬€佺粨鏋勩€佺粨灏俱€佺垎鐐瑰拰澶嶅埢鏂规銆?/p>}
      </section>
    </div>
  );
}

const viralStages = ['downloading', 'extracting', 'transcribing', 'analyzing_frames', 'breaking_down', 'recreating', 'completed'];

function latestViralEventForStage(events: ViralAnalysisEvent[], stage: string): ViralAnalysisEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.stage === stage) return event;
  }
  return null;
}

function normalizeViralKeyFrameCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(40, Math.max(1, Math.round(parsed)));
}

function ViralChoiceGroup({
  title,
  options,
  value,
  onChange,
  compact = false,
}: {
  title: string;
  options: string[][];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? 'viral-choice-section compact' : 'viral-choice-section'}>
      <span>{title}</span>
      <div className="viral-choice-grid" role="radiogroup" aria-label={title}>
        {options.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'viral-choice-button active' : 'viral-choice-button'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

type ViralInsightTab = 'copy' | 'prompt';

function ViralReport({
  result,
  createProductionTask,
  saveTemplates,
  track,
  style,
  draftTemplateId,
}: {
  result: ViralAnalysisResult;
  createProductionTask: () => void;
  saveTemplates: (input: { storyTemplateName: string; imageTemplateName: string }) => Promise<void>;
  track: string;
  style: string;
  draftTemplateId: string;
}) {
  const [insightTab, setInsightTab] = useState<ViralInsightTab>('copy');
  const defaultTemplateBaseName = viralTemplateBaseName(result);
  const [storyTemplateName, setStoryTemplateName] = useState(`鐖嗘鏁呬簨妯℃澘 - ${defaultTemplateBaseName}`);
  const [imageTemplateName, setImageTemplateName] = useState(`鐖嗘鍥剧墖妯℃澘 - ${defaultTemplateBaseName}`);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState('');
  const breakdown = result.contentBreakdown;
  const frames = uniqueViralPromptFrames(result.frames);
  const keyFrameCount = frames.length;
  const originalCopy = viralTranscriptText(result);
  const templatePreview = useMemo(
    () =>
      createViralTemplateDrafts(result, {
        storyTemplateName: storyTemplateName.trim() || `鐖嗘鏁呬簨妯℃澘 - ${defaultTemplateBaseName}`,
        imageTemplateName: imageTemplateName.trim() || `鐖嗘鍥剧墖妯℃澘 - ${defaultTemplateBaseName}`,
        track,
        style,
        draftTemplateId,
      }),
    [result, storyTemplateName, imageTemplateName, track, style, draftTemplateId, defaultTemplateBaseName],
  );

  useEffect(() => {
    setStoryTemplateName(`鐖嗘鏁呬簨妯℃澘 - ${defaultTemplateBaseName}`);
    setImageTemplateName(`鐖嗘鍥剧墖妯℃澘 - ${defaultTemplateBaseName}`);
    setTemplateSaveError('');
  }, [defaultTemplateBaseName]);

  async function handleSaveTemplates() {
    const nextStoryName = storyTemplateName.trim();
    const nextImageName = imageTemplateName.trim();
    if (!nextStoryName || !nextImageName || savingTemplates) return;
    setSavingTemplates(true);
    setTemplateSaveError('');
    try {
      await saveTemplates({ storyTemplateName: nextStoryName, imageTemplateName: nextImageName });
    } catch (error) {
      setTemplateSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTemplates(false);
    }
  }

  return (
    <>
      <div className="viral-report-grid">
        <ViralReportCard title="寮€澶? value={breakdown.opening.type} detail={breakdown.opening.analysis} />
        <ViralReportCard title="缁撴瀯" value={breakdown.structure.type} detail={breakdown.structure.analysis} />
        <ViralReportCard title="缁撳熬" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
        <ViralReportCard title="鐖嗙偣" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
      </div>
      <div className="viral-frame-insights">
        <div className="viral-insight-tabs" role="tablist" aria-label="鍥炬枃鎷嗚В">
          <button type="button" className={insightTab === 'copy' ? 'active' : ''} onClick={() => setInsightTab('copy')}>鏂囨鎷嗚В</button>
          <button type="button" className={insightTab === 'prompt' ? 'active' : ''} onClick={() => setInsightTab('prompt')}>鎻愮ず璇嶆媶瑙?/button>
          <span className="viral-keyframe-count">鍏抽敭甯ф暟閲忥細{keyFrameCount}</span>
        </div>
        {insightTab === 'copy' ? (
          <div className="viral-copy-breakdown">
            <section className="viral-original-copy">
              <span>鍘熸枃妗?/span>
              <p>{originalCopy || '鏆傛棤杞啓鏂囨銆傚彲浠ュ厛纭璇煶杞枃瀛楅厤缃紝鎴栨煡鐪嬩笅鏂规爣棰樸€佸紑澶淬€佺粨鏋勪笌鐖嗙偣鎷嗚В銆?}</p>
            </section>
            <div className="viral-copy-grid">
              <ViralCopyCard title="鏍囬鏂囨" value={breakdown.title.original || result.source.title || '鏈瘑鍒爣棰?} detail={breakdown.title.pattern} />
              <ViralCopyCard title="寮€澶磋瘽鏈? value={breakdown.opening.type} detail={breakdown.opening.analysis} />
              <ViralCopyCard title="缁撳熬璇濇湳" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
              <ViralCopyCard title="鐖嗙偣琛ㄨ揪" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
            </div>
          </div>
        ) : (
          <div className="viral-insight-list">
            {frames.map((frame) => (
              <article className="viral-insight-card" key={`${frame.timestamp}-${frame.framePath}`}>
                <span>{formatViralFrameTimestamp(frame.timestamp)} 路 鐢熷浘鎻愮ず璇嶆媶瑙?/span>
                <strong>{frameImagePrompt(frame)}</strong>
                <p>{framePromptDetail(frame)}</p>
              </article>
            ))}
            {frames.length === 0 ? <p className="muted-text">鏆傛棤鍏抽敭甯ф彁绀鸿瘝鎷嗚В缁撴灉</p> : null}
          </div>
        )}
      </div>
      <div className="viral-followup-panel">
        <h3>鍚庣画鎿嶄綔</h3>
        <p>{result.recreation.blueprint}</p>
        <ViralTemplatePreviewField label="鏁呬簨搴曠锛坰cript锛? value={result.recreation.script || result.recreation.storyContent || result.recreation.blueprint} />
        <div className="viral-template-preview-grid">
          <section className="viral-template-preview-section">
            <span className="field-title">鏁呬簨妯℃澘棰勮</span>
            <ViralTemplatePreviewField label="妯℃澘姝ｆ枃锛堝惈棰勫锛? value={templatePreview.storyTemplate.content} />
            <div className="viral-template-preview-subgrid">
              <ViralTemplatePreviewField label="Step 0 棰勫" value={templatePreview.storyTemplate.stepPrompts?.review ?? ''} />
              <ViralTemplatePreviewField label="Step 1 鏀瑰啓" value={templatePreview.storyTemplate.stepPrompts?.rewrite ?? ''} />
              <ViralTemplatePreviewField label="Step 2 灏侀潰" value={templatePreview.storyTemplate.stepPrompts?.cover ?? ''} />
              <ViralTemplatePreviewField label="Step 3 鍒嗛暅" value={templatePreview.storyTemplate.stepPrompts?.storyboard ?? ''} />
              <ViralTemplatePreviewField label="鎶藉抚鎻愮ず璇嶆ā鏉匡紙鐢熸垚鐢級" value={templatePreview.storyTemplate.stepPrompts?.['image-prompt'] ?? ''} />
            </div>
          </section>
          <section className="viral-template-preview-section">
            <span className="field-title">鍥剧墖妯℃澘棰勮</span>
            <ViralTemplatePreviewField label="鍓嶇紑锛坧refix锛? value={templatePreview.imageTemplate.prefix} />
            <ViralTemplatePreviewField label="鍚庣紑锛坰uffix锛? value={templatePreview.imageTemplate.suffix} />
            <ViralTemplatePreviewField label="璐熼潰鎻愮ず璇嶏紙negativePrompt锛? value={templatePreview.imageTemplate.negativePrompt} />
            <ViralTemplatePreviewField label="閫傜敤鍦烘櫙鎻忚堪" value={templatePreview.imageTemplate.description} />
          </section>
        </div>
        <div className="viral-template-name-grid">
          <Field label="鏁呬簨妯℃澘鍚?>
            <input className="text-input" value={storyTemplateName} onChange={(event) => setStoryTemplateName(event.target.value)} />
          </Field>
          <Field label="鍥剧墖妯℃澘鍚?>
            <input className="text-input" value={imageTemplateName} onChange={(event) => setImageTemplateName(event.target.value)} />
          </Field>
        </div>
        {templateSaveError ? <p className="form-error">{templateSaveError}</p> : null}
        <div className="viral-followup-actions">
          <button className="primary-action" disabled={savingTemplates || !storyTemplateName.trim() || !imageTemplateName.trim()} onClick={() => void handleSaveTemplates()}>
            {savingTemplates ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            {savingTemplates ? '淇濆瓨涓? : '淇濆瓨涓烘ā鏉?}
          </button>
          <button className="ghost-action viral-create-production-task" onClick={createProductionTask}>
            <Wand2 size={16} />
            鐢熸垚鏂颁换鍔?          </button>
        </div>
      </div>
    </>
  );
}

function viralTranscriptText(result: ViralAnalysisResult): string {
  return result.transcript.map((segment) => segment.text.trim()).filter(Boolean).join('\n');
}

function viralTemplateBaseName(result: ViralAnalysisResult): string {
  return trimForPreview(result.source.title || result.contentBreakdown.topic || '鐭棰?, 18);
}

function frameImagePrompt(frame: ViralAnalysisResult['frames'][number]): string {
  return frame.imagePrompt || [
    frame.shotType,
    frame.composition,
    frame.visualDescription,
    frame.mood,
    frame.keyElements.length ? `鍏抽敭鍏冪礌锛?{frame.keyElements.join('銆?)}` : '',
  ].filter(Boolean).join('锛?);
}

function framePromptDetail(frame: ViralAnalysisResult['frames'][number]): string {
  return [
    frame.visualDescription,
    frame.textOverlay ? `鐢婚潰鏂囧瓧锛?{frame.textOverlay}` : '',
    frame.keyElements.length ? `鍏抽敭鍏冪礌锛?{frame.keyElements.join('銆?)}` : '',
  ].filter(Boolean).join('\n');
}

function uniqueViralPromptFrames(frames: ViralAnalysisResult['frames']): ViralAnalysisResult['frames'] {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    const signature = [
      frame.imagePrompt,
      frame.visualDescription,
      frame.textOverlay ?? '',
      frame.composition,
    ].map((item) => item.trim()).filter(Boolean).join('|') || `${frame.timestamp}-${frame.framePath}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function ViralCopyCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-insight-card viral-copy-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ViralTemplatePreviewField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <textarea className="small-textarea viral-template-preview-textarea" value={value || '鏆傛棤鍐呭'} readOnly spellCheck={false} />
    </Field>
  );
}

function formatViralFrameTimestamp(timestamp: number): string {
  return `${Math.max(0, Math.round(timestamp))}s`;
}

function ViralReportCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-report-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function viralPlatformLabel(platform: ViralPlatform): string {
  return { douyin: '鎶栭煶', kuaishou: '蹇墜', bilibili: 'B绔?, unknown: '鑷姩璇嗗埆' }[platform];
}

function viralSourceModeLabel(mode: ViralSourceMode): string {
  return mode === 'auto' ? '鑷姩璇嗗埆' : viralPlatformLabel(mode);
}

function detectBrowserViralPlatform(url: string): ViralPlatform {
  const normalized = url.toLowerCase();
  if (/douyin\.com|iesdouyin\.com|amemv\.com/.test(normalized)) return 'douyin';
  if (/kuaishou\.com|gifshow\.com|kwai\.com/.test(normalized)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/.test(normalized)) return 'bilibili';
  return 'unknown';
}

function viralStatusLabel(status: ViralAnalysisStatus): string {
  return { pending: '绛夊緟', running: '杩愯涓?, paused: '鏆傚仠', completed: '宸插畬鎴?, failed: '澶辫触', cancelled: '宸插彇娑? }[status];
}

function viralStageLabel(stage: string): string {
  return {
    downloading: '涓嬭浇瑙嗛',
    extracting: '鎶藉抚鎻愰煶棰?,
    transcribing: '璇煶杞啓',
    analyzing_frames: '鐢婚潰鍒嗘瀽',
    breaking_down: '鍐呭鎷嗚В',
    recreating: '澶嶅埢鐢熸垚',
    completed: '瀹屾垚',
  }[stage] ?? stage;
}

function NewTaskPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const initialDraftTemplateId = defaultTaskDraftTemplateId(state.draftTemplates);
  const [mode, setMode] = useState<TaskMode>('paste');
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState(sampleText);
  const [aiKeyword, setAiKeyword] = useState('姝﹀垯澶╁洖瀹?);
  const [aiSources, setAiSources] = useState(['web']);
  const [extraRequirements, setExtraRequirements] = useState('瀛楁暟鎺у埗鍦?500 瀛楀乏鍙筹紝鑱氱劍浜虹墿杞姌缁忓巻锛岃姘斿亸鎰熸€?);
  const [track, setTrack] = useState('character-story');
  const [style, setStyle] = useState('photo-real');
  const [templateId, setTemplateId] = useState(initialDraftTemplateId);
  const [ratio, setRatio] = useState(() => draftTemplateImageRatio(state.draftTemplates, initialDraftTemplateId));
  const [selectedTaskLlmProfileId, setSelectedTaskLlmProfileId] = useState(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
  const [promptTemplateOverrideId, setPromptTemplateOverrideId] = useState('');
  const [promptTemplateManuallyOverridden, setPromptTemplateManuallyOverridden] = useState(false);
  const [styleManuallyOverridden, setStyleManuallyOverridden] = useState(false);
  const [draftTemplateManuallyOverridden, setDraftTemplateManuallyOverridden] = useState(false);
  const [ratioManuallyOverridden, setRatioManuallyOverridden] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [speaker, setSpeaker] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [bgmId, setBgmId] = useState(() => resolveDefaultBgmId(state.config));
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pausePoint, setPausePoint] = useState<PausePoint>('none');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [rewriteIntensity, setRewriteIntensity] = useState<RewriteIntensity>('standard');
  const [narrativePov, setNarrativePov] = useState<Task['narrativePov']>('keep-original');
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [targetLength, setTargetLength] = useState('');
  const [storyboardSceneCount, setStoryboardSceneCount] = useState('12');
  const [publishMode, setPublishMode] = useState<'review-rewrite' | 'direct-copy'>('review-rewrite');
  const [videoForm, setVideoForm] = useState<TaskVideoForm>('narration');
  const [coverImageMode, setCoverImageMode] = useState('off');
  const [coverTemplateId, setCoverTemplateId] = useState('cinematic-poster');
  const [podcastImageMode, setPodcastImageMode] = useState('multi');
  const [podcastSpeakers, setPodcastSpeakers] = useState<PodcastSpeakerPair>('kazai-dayi');
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [searchingSources, setSearchingSources] = useState(false);
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(null);
  const [selectedSearchSourceIds, setSelectedSearchSourceIds] = useState<string[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [composingCopy, setComposingCopy] = useState(false);
  const [researchCopy, setResearchCopy] = useState('');
  const [researchCopyMessage, setResearchCopyMessage] = useState('');

  const searchSections = (searchContext?.sections ?? []).slice(0, 10);
  const selectedSources = searchSections.filter((source, index) => selectedSearchSourceIds.includes(sourceKey(source, index)));
  const taskPromptTemplates = state.promptTemplates.filter((template) => template.type === 'task');
  const storyTemplateOptions = buildStoryTemplateOptions(taskPromptTemplates);
  const taskPromptTemplateOptions = buildTaskPromptTemplateOptions(state.promptTemplates, track);
  const imageTemplateStyleOptions = buildImageTemplateStyleOptions(state.customStyles);
  const resolvedPromptTemplate = resolvePromptTemplateForTrack(state.promptTemplates, track, promptTemplateOverrideId || null);
  const selectedStoryTemplateId = promptTemplateOverrideId || resolvedPromptTemplate?.id || '';
  const availableStyleIds = state.customStyles.map((customStyle) => customStyle.id);
  const availableDraftTemplateIds = state.draftTemplates.map((draftTemplate) => draftTemplate.id);
  const primaryDraftTemplates = state.draftTemplates.filter((draftTemplate) => !isBundledDraftTemplateOption(draftTemplate));
  const alternateDraftTemplates = state.draftTemplates.filter(isBundledDraftTemplateOption);
  const bgmOptions = validBgmItems(state.config);
  const ttsVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider);
  const podcastVoiceDefaults = defaultPodcastSpeakersForProvider(ttsProvider, podcastSpeakers);
  const storyDreamCoverTemplateIds = ['cinematic-poster', 'podcast-cover'];
  const coverTemplateOptions = state.customCoverTemplates.map((template) => [template.id, template.name, template.description]);
  const coverTemplateSelectOptions = coverTemplateOptions.length
    ? coverTemplateOptions
    : [['cinematic-poster', '鐢靛奖娴锋姤灏侀潰', 'StoryDream 榛樿灏侀潰妯℃澘']];
  const coverTemplateHint = storyDreamCoverTemplateIds.includes(coverTemplateId) ? 'StoryDream 鍏煎妯℃澘' : '鑷畾涔夊皝闈㈡ā鏉?;

  useEffect(() => {
    setBgmId((current) => (current && bgmOptions.some((bgm) => bgm.id === current) ? current : resolveDefaultBgmId(state.config)));
  }, [state.config.jianying.bgmLibrary, state.config.jianying.defaultBgmId]);

  useEffect(() => {
    const provider = normalizeRuntimeTtsProvider(state.config.tts.provider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }, [state.config.activeTtsProfileId, state.config.tts.provider, state.config.tts.speaker, state.config.tts.volcengine.speaker, state.config.tts.minimax.voiceId]);

  useEffect(() => {
    if (!state.config.llmProfiles.some((profile) => profile.id === selectedTaskLlmProfileId)) {
      setSelectedTaskLlmProfileId(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
    }
  }, [state.config.activeLlmProfileId, state.config.llm.id, state.config.llmProfiles, selectedTaskLlmProfileId]);

  useEffect(() => {
    if (!styleManuallyOverridden && resolvedPromptTemplate) {
      setStyle(resolvePromptTemplateDefaultStyleId(resolvedPromptTemplate, availableStyleIds));
    }
  }, [resolvedPromptTemplate?.id, styleManuallyOverridden, state.customStyles]);

  function handleStoryTemplateChange(nextTemplateId: string) {
    setPromptTemplateManuallyOverridden(true);
    setPromptTemplateOverrideId(nextTemplateId);
    const template = state.promptTemplates.find((item) => item.id === nextTemplateId && item.type === 'task') ?? null;
    const nextTrack = template?.baseTrack || track;
    if (nextTrack !== track) {
      setTrack(nextTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextDraftTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextDraftTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextDraftTemplateId));
      }
    }
  }

  function handleStyleChange(nextStyle: string) {
    setStyleManuallyOverridden(true);
    setStyle(nextStyle);
  }

  function handleDraftTemplateChange(nextTemplateId: string) {
    setDraftTemplateManuallyOverridden(true);
    setTemplateId(nextTemplateId);
    setRatioManuallyOverridden(false);
    setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
  }

  function handleRatioChange(nextRatio: string) {
    setRatioManuallyOverridden(true);
    setRatio(nextRatio);
  }

  function handlePromptTemplateOverrideChange(nextId: string) {
    setPromptTemplateManuallyOverridden(Boolean(nextId));
    setPromptTemplateOverrideId(nextId);
    const template = resolvePromptTemplateForTrack(state.promptTemplates, track, nextId || null);
    if (template?.baseTrack && template.baseTrack !== track) {
      setTrack(template.baseTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
      }
    }
  }

  function handleTtsProviderChange(nextProvider: string) {
    const provider = normalizeRuntimeTtsProvider(nextProvider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }

  async function searchWebSources() {
    const keyword = aiKeyword.trim();
    if (!keyword) {
      setSearchMessage('璇峰厛杈撳叆鍏抽敭璇嶃€?);
      return;
    }
    setSearchingSources(true);
    setSearchMessage('姝ｅ湪浠?Bing 鎼滅储骞惰鍙栫綉椤垫鏂?..');
    try {
      const context = await api.searchWebSources(keyword);
      const limitedContext = { ...context, sections: context.sections.slice(0, 10) };
      setSearchContext(limitedContext);
      setSelectedSearchSourceIds([]);
      setSearchMessage(context.warnings.length ? context.warnings.join('锛?) : `宸茶幏鍙栧墠 ${limitedContext.sections.length} 鏉＄綉椤佃祫鏂欙紝璇峰嬀閫夎浣跨敤鐨勯〉闈€俙);
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingSources(false);
    }
  }

  async function composeResearchCopy() {
    if (selectedSources.length === 0) {
      setResearchCopyMessage('璇峰厛鍕鹃€夎嚦灏?1 涓綉椤垫潵婧愩€?);
      return;
    }
    setComposingCopy(true);
    setResearchCopyMessage('姝ｅ湪缁撳悎鎵€閫夐〉闈俊鎭敓鎴愭枃妗?..');
    try {
      const result = await api.composeResearchCopy({
        keyword: aiKeyword.trim(),
        extraRequirements,
        selectedSources,
      });
      setResearchCopy(result.copy);
      setInputText(result.copy);
      setTitle(result.title || aiKeyword.trim());
      setMode('paste');
      setResearchCopyMessage(`宸茬敓鎴愭枃妗堝苟濉叆绮樿创鏂囨${result.requestId ? `锛坮equest ${result.requestId}锛塦 : ''}銆俙);
    } catch (error) {
      setResearchCopyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setComposingCopy(false);
    }
  }

  async function addBgmFromTask() {
    const audioPath = await api.selectLocalAudio();
    if (!audioPath) return;
    const nextBgm = addUploadedBgm(state.config, audioPath);
    const next = await api.saveConfig(nextBgm.config);
    applyState(next);
    setBgmId(nextBgm.bgmId);
  }

  async function selectTaskReferenceImage() {
    const imagePath = await api.selectLocalImage();
    if (imagePath) setReferenceImagePath(imagePath);
  }

  async function run() {
    if (isBrowserPreview) {
      setDraftNotice('娴忚鍣ㄩ瑙堜笉鑳芥墽琛岀湡瀹炴祦姘寸嚎锛岃鍦?Electron 搴旂敤涓繍琛屼换鍔°€?);
      return;
    }
    setRunning(true);
    try {
      const next = await api.createAndRunTask({
        title,
        inputText: mode === 'paste' ? inputText : researchCopy.trim() || `${aiKeyword}\n\n${extraRequirements}`,
        mode,
        aiKeyword,
        aiSources,
        selectedSources: mode === 'ai' ? selectedSources : [],
        extraRequirements,
        track,
        style,
        speaker,
        ratio,
        templateId,
        llmProfileId: selectedTaskLlmProfileId,
        videoForm,
        coverImageMode,
        coverTemplateId,
        podcastImageMode,
        podcastSpeakers: videoForm === 'two-host-podcast' ? podcastSpeakers : null,
        podcastSpeakerA: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerA : null,
        podcastSpeakerB: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerB : null,
        scriptFormat: videoForm === 'two-host-podcast' ? 'dialogue' : 'narration',
        bgmId,
        pausePoints: [pausePoint],
        processingMode,
        referenceImagePath,
        rewriteIntensity,
        narrativePov,
        keepPromotion,
        ttsProvider,
        ttsSpeed,
        publishMode,
        targetLength: normalizeTaskTargetLength(targetLength) ?? undefined,
        targetScenes: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        storyboardSceneCount: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        promptTemplateId: resolvedPromptTemplate?.id ?? null,
        promptTemplateType: 'task',
      });
      applyState(next);
      const createdTask = next.tasks[0];
      if (createdTask) {
        openTaskDetail(createdTask.id);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="new-task-scroll">
      <section className="task-card">
        <Field label="鏍囬" hint="鍙€?>
          <input value={title} placeholder="鐣欑┖浼氫粠鏂囨鑷姩鎻愬彇" onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="mode-grid">
          <button className={mode === 'paste' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('paste')}>
            <strong>绮樿创鏂囨</strong>
            <span>宸叉湁瀵规爣鏂囨锛岀洿鎺ヨ创杩涙潵鏀瑰啓</span>
          </button>
          <button className={mode === 'ai' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('ai')}>
            <strong>AI 鍒涗綔 <em>NEW</em></strong>
            <span>杈撳叆鍏抽敭璇嶏紝AI 鑷姩鎼滅储骞跺垱浣滃師绋?/span>
          </button>
        </div>

        {mode === 'paste' ? (
          <Field label="鏂囨鍐呭">
            <textarea className="source-textarea" value={inputText} onChange={(event) => setInputText(event.target.value)} />
          </Field>
        ) : (
          <div className="ai-create-panel">
            <Field label="鍏抽敭璇?>
              <input value={aiKeyword} onChange={(event) => setAiKeyword(event.target.value)} placeholder="渚嬪锛氶挶瀛︽．鍥炲浗 / 寮犳姊?/ 鑻规灉绉嬪鍙戝竷浼? />
            </Field>
            <span className="field-title">鏁版嵁婧?/span>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('web')} onChange={() => setAiSources(toggleArray(aiSources, 'web'))} />
              鍏ㄧ綉鎼滅储 <small>浠?Bing + 鎼滅嫍 + 鐧惧害 + 360 鎼滅储锛岃ˉ鍏呯櫨绉戙€佺煡涔庛€佺櫨瀹跺彿銆佸ご鏉℃鏂?/small>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('builtin-knowledge')} onChange={() => setAiSources(toggleArray(aiSources, 'builtin-knowledge'))} />
              AI 鍐呯疆鐭ヨ瘑琛ュ叏 <small>鍏佽 AI 鐢ㄨ嚜宸辩殑鐭ヨ瘑琛ュ叏缁嗚妭</small>
            </label>
            <label className="check-row muted">
              <input type="checkbox" checked={aiSources.includes('ima')} onChange={() => setAiSources(toggleArray(aiSources, 'ima'))} />
              IMA 鐭ヨ瘑搴?<small>鍓嶅線绯荤粺璁剧疆 路 AI 鍒涗綔閰嶇疆</small>
            </label>
            <Field label="棰濆瑕佹眰" hint="鍙€?>
              <input className="extra-requirements-input" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
            </Field>
            <button className="ghost-action" disabled={searchingSources || !aiKeyword.trim()} onClick={searchWebSources}>
              {searchingSources ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              鎼滅储
            </button>
            {searchMessage ? <div className="test-result">{searchMessage}</div> : null}
            {searchContext ? (
              <div className="ai-search-block">
                <div className="ai-search-results ai-search-results-scroll">
                  <div className="panel-title-row">
                    <h3>缃戦〉鍊欓€夛紙鍓?10 鏉★級</h3>
                    <small>{selectedSources.length}/{searchContext.sections.length} 宸查€夋嫨</small>
                  </div>
                  {searchContext.sections.length === 0 ? <EmptyState title="鏆傛棤鍙敤缃戦〉璧勬枡" /> : null}
                  {searchContext.sections.map((source, index) => {
                    const id = sourceKey(source, index);
                    return (
                      <label className="search-source-card" key={id}>
                        <input type="checkbox" checked={selectedSearchSourceIds.includes(id)} onChange={() => setSelectedSearchSourceIds(toggleArray(selectedSearchSourceIds, id))} />
                        <div>
                          <strong>{source.title}</strong>
                          {source.url ? <span>{source.url}</span> : null}
                          <p>{(source.content || source.snippet || '').slice(0, 220)}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="ai-search-actions">
                  <button className="primary-action slim" disabled={composingCopy || selectedSources.length === 0} onClick={composeResearchCopy}>
                    {composingCopy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
                    缁撳悎鎵€閫夐〉闈俊鎭敓鎴愭枃妗?
                  </button>
                </div>
                {researchCopyMessage ? <div className="test-result">{researchCopyMessage}</div> : null}
                {researchCopy ? (
                  <Field label="鐢熸垚鏂囨锛堝彲缂栬緫锛?>
                    <textarea className="small-textarea research-copy-textarea" value={researchCopy} onChange={(event) => setResearchCopy(event.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <OptionCloud title="鍐呭璧涢亾" options={storyTemplateOptions} value={selectedStoryTemplateId} onChange={handleStoryTemplateChange} />
        <Field label="鎻愮ず璇嶆ā鏉? hint={resolvedPromptTemplate ? `褰撳墠浣跨敤锛?{resolvedPromptTemplate.name}` : '鑷姩鍖归厤璧涢亾妯℃澘'}>
          <select className="prompt-template-selector" value={promptTemplateOverrideId || resolvedPromptTemplate?.id || ''} onChange={(event) => handlePromptTemplateOverrideChange(event.target.value)}>
            <option value="">鑷姩鍖归厤璧涢亾妯℃澘</option>
            {taskPromptTemplateOptions.map(([id, label, hint]) => (
              <option key={id} value={id}>
                {hint ? `${label} 路 ${hint}` : label}
              </option>
            ))}
          </select>
        </Field>
        <OptionCloud title="鐢婚潰椋庢牸" options={imageTemplateStyleOptions} value={style} onChange={handleStyleChange} />
        {resolvedPromptTemplate ? (
          <div className="template-default-summary">
            <strong>妯℃澘榛樿椤?/strong>
            <span>鏁呬簨妯℃澘锛歿resolvedPromptTemplate.name}</span>
            <span>榛樿鍥惧儚妯℃澘锛歿styleLabel(style, state.customStyles)}</span>
            <span>榛樿鑽夌妯℃澘锛歿draftTemplateLabel(templateId, state.draftTemplates)}</span>
            <span>涓昏妗ｆ锛歿characterPolicyLabel(resolvedPromptTemplate.characterPolicy)}</span>
            <span>鍙傝€冨浘绫诲瀷锛歿referenceKindLabel(resolvedPromptTemplate.referenceKind)}</span>
            <span>Step 3 楠ㄦ灦锛歿(resolvedPromptTemplate.step3SkeletonModules ?? []).join('銆?) || '鏈缃?}</span>
          </div>
        ) : null}

        <div className="video-form-panel">
          <div className="video-form-head">
            <span className="field-title">瑙嗛褰㈡€?/span>
            <small>{videoForm === 'two-host-podcast' ? '鍙屼汉鎾浼氳嚜鍔ㄤ娇鐢ㄥ璇濊剼鏈拰鎾閰嶅浘绛栫暐' : '鍗曚汉閰嶉煶璁茶堪锛岄€傚悎甯歌鏃佺櫧瑙嗛'}</small>
          </div>
          <div className="video-form-grid">
            <button className={videoForm === 'narration' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('narration')}>
              <strong>鏃佺櫧瑙嗛</strong>
              <span>鍗曚汉閰嶉煶璁茶堪锛堥粯璁わ級</span>
            </button>
            <button className={videoForm === 'two-host-podcast' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('two-host-podcast')}>
              <strong>鍙屼汉鎾</strong>
              <span>涓や綅涓绘挱涓€闂竴绛旇亰鍐呭</span>
            </button>
          </div>
          {videoForm === 'two-host-podcast' ? (
            <div className="podcast-form-controls">
              <span className="podcast-form-label">鎾閰嶅浘</span>
              <Segmented label="閰嶅浘鏂瑰紡" value={podcastImageMode} options={['multi', 'single']} labels={['鎸夊垎闀滈厤鍥?, '鍗曞浘灏侀潰']} onChange={setPodcastImageMode} />
              <Segmented
                label="涓绘挱缁勫悎"
                value={podcastSpeakers}
                options={['kazai-dayi', 'liufei-xiaolei']}
                labels={['鍜斾粩 x 澶у９', '鍒橀 x 娼囩']}
                onChange={(value) => setPodcastSpeakers(value as PodcastSpeakerPair)}
              />
              <p className="podcast-form-note">涓绘挱缁勫悎浼氬啓鍏ュ璇濊剼鏈笌鎾灏侀潰鎻愮ず锛屽苟鑷姩浣跨敤涓ゅ榛樿闊宠壊鐢熸垚 A/B 瀵硅瘽銆?/p>
            </div>
          ) : null}
        </div>

        <div className="option-two-col">
          <Field label="灏侀潰妯℃澘" hint={coverTemplateHint}>
            <select className="cover-template-select" value={coverTemplateId} onChange={(event) => setCoverTemplateId(event.target.value)}>
              {coverTemplateSelectOptions.map(([id, label, hint]) => (
                <option key={id} value={id}>
                  {hint ? `${label} 路 ${id}` : label}
                </option>
              ))}
            </select>
          </Field>
          <Segmented label="灏侀潰鐢熸垚" value={coverImageMode} options={['off', 'auto', 'manual']} labels={['鍏抽棴', '鑷姩', '浠呭皝闈?]} onChange={setCoverImageMode} />
        </div>

        <div className="option-two-col">
          <div className="draft-template-picker-stack">
            <OptionCloud title="鑽夌妯℃澘" options={primaryDraftTemplates.map((template) => [template.id, template.name, `鍑哄浘 ${template.image.ratio}`])} value={templateId} onChange={handleDraftTemplateChange} />
            {alternateDraftTemplates.length ? (
              <Field label="妯℃澘澶囬€?>
                <select
                  className="draft-template-alternate-select"
                  value={alternateDraftTemplates.some((template) => template.id === templateId) ? templateId : ''}
                  onChange={(event) => handleDraftTemplateChange(event.target.value || primaryDraftTemplates[0]?.id || templateId)}
                >
                  <option value="">閫夋嫨澶囬€夋ā鏉?/option>
                  {alternateDraftTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} 路 鍑哄浘 {template.image.ratio}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <div>
            <span className="field-title">AI 鍑哄浘姣斾緥 <small>{ratioManuallyOverridden ? '宸叉墜鍔ㄨ鐩? : '宸茶窡闅忚崏绋挎ā鏉?}</small></span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => handleRatioChange(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="target-controls-row">
          <label className="target-number-field">
            <span>鐩爣瀛楁暟</span>
            <input
              type="number"
              min="100"
              max="5000"
              step="50"
              value={targetLength}
              placeholder="鑷姩"
              onChange={(event) => setTargetLength(event.target.value)}
            />
            <small>瀛楋紙卤15%锛岀暀绌鸿窡闅忓師鏂囷級</small>
          </label>
          <label className="target-number-field">
            <span>鐩爣鍒嗛暅鏁?/span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={storyboardSceneCount}
              onChange={(event) => setStoryboardSceneCount(event.target.value)}
            />
            <small>涓紙卤10%锛屽缓璁瘡闀?25-45 瀛楋級</small>
          </label>
          <label className="target-number-field">
            <span>鍙戝竷鏂瑰紡</span>
            <Segmented
              label=""
              value={publishMode}
              options={['review-rewrite', 'direct-copy']}
              labels={['棰勫鏀瑰啓', '鐩存帴鏁呭彂']}
              onChange={(value) => setPublishMode(value as 'review-rewrite' | 'direct-copy')}
            />
            <small>棰勫鏀瑰啓浼氳蛋瀹屽叏娴佺▼锛岀洿鎺ョ粰鍘熸枃鍙互璺宠繃 Step 0 / 1</small>
          </label>
        </div>

        <>
          <span className="field-title">閰嶉煶鍛?/span>
          <Segmented label="閰嶉煶妯″瀷" value={ttsProvider} options={['volcengine', 'minimax']} labels={['璞嗗寘', 'MiniMax']} onChange={handleTtsProviderChange} />
          {videoForm !== 'two-host-podcast' ? (
            <>
            <div className="chip-row">
              {ttsVoiceOptions.map((voice) => (
                <button key={voice.id} className={speaker === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setSpeaker(voice.id)}>
                  <Mic2 size={14} />
                  {voice.label}
                </button>
              ))}
            </div>
            <span className="hint-text">褰撳墠榛樿閰嶉煶鍛橈細{taskSpeakerLabel(ttsProvider, speaker)} 路 {speaker}</span>
            </>
          ) : <span className="hint-text">鍙屼汉鎾浼氭寜涓绘挱缁勫悎鑷姩鎷嗗垎 A/B 闊宠壊锛屽綋鍓嶆ā鍨嬶細{ttsProvider}</span>}
        </>

        <span className="field-title">鑳屾櫙闊充箰</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>
            鏃?BGM
          </button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>
              {bgm.title}
            </button>
          ))}
          <button className="chip" onClick={addBgmFromTask}><Plus size={14} />娣诲姞</button>
        </div>

        <Field label="涓昏鍙傝€冨浘" hint="鍙€?>
          <div className="upload-row">
            <input value={referenceImagePath} placeholder="涓婁紶鍚庡嚭鐜颁富瑙掔殑鍒嗛暅浼氫互杩欏紶涓哄熀纭€淇濇寔浜虹墿涓€鑷? onChange={(event) => setReferenceImagePath(event.target.value)} />
            <button className="ghost-action" onClick={selectTaskReferenceImage}>
              <Upload size={15} />
              涓婁紶涓昏鍙傝€冨浘
            </button>
          </div>
        </Field>

        <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '鈻? : '鈻?} 楂樼骇閫夐」 <span>鏀瑰啓寮哄害 路 鍙欎簨瑙嗚 路 甯﹁揣 路 澶勭悊妯″紡 路 鏆傚仠纭</span>
        </button>
        {showAdvanced ? (
          <div className="advanced-grid">
            <Segmented label="澶勭悊妯″紡" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['鍏ㄨ嚜鍔?, '鍗婅嚜鍔?, '鍙嚭鏂规']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
            <Segmented label="鏆傚仠纭" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
            <Segmented label="鏀瑰啓寮哄害" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
            <Segmented label="鍙欎簨瑙嗚" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
            <label className="toggle-row">
              <input type="checkbox" checked={keepPromotion} onChange={(event) => setKeepPromotion(event.target.checked)} />
              甯﹁揣妯″紡 <small>鏀瑰啓鏃跺垹闄ゅ甫璐ф钀?/small>
            </label>
            <Segmented label="閰嶉煶璇€? value={String(ttsSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['鎱㈤€?0.85x', '榛樿 1.0x', '蹇€?1.15x', '鏇村揩 1.3x']} onChange={(value) => setTtsSpeed(Number(value))} />
            <Field label="鑷畾涔?/ 鍏朵粬妯″瀷">
              <select value={selectedTaskLlmProfileId} onChange={(event) => setSelectedTaskLlmProfileId(event.target.value)}>
                {state.config.llmProfiles.map((profile) => (
                  <option key={profile.id ?? profile.model} value={profile.id ?? profile.model}>
                    {profile.provider}: {profile.model}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <div className="task-footer">
          <span className="danger-text">{isBrowserPreview ? '娴忚鍣ㄩ瑙堜笉鑳芥墽琛岀湡瀹炴祦姘寸嚎' : '璇曠敤宸茬敤灏斤紝澶嶅埢鐗堜粎鏈湴妯℃嫙锛屼笉闃绘柇鐢熸垚'}</span>
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraftNotice('宸蹭繚瀛樹负鏈湴鑽夌棰勮')}>
              淇濆瓨涓鸿崏绋?
            </button>
            <button className="primary-action" onClick={run} disabled={isBrowserPreview || running || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0)}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              {running ? '杩愯涓? : '寮€濮嬬敓鎴?}
            </button>
          </div>
        </div>
        {draftNotice ? <span className="local-note">{draftNotice}</span> : null}
      </section>
    </div>
  );
}

function MusicMvPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const defaultTemplateId = state.draftTemplates[0]?.id ?? 'default-portrait-9-16';
  const [title, setTitle] = useState('闊充箰MV');
  const [lyrics, setLyrics] = useState('闆ㄨ惤涓嬬涓€鍙n闇撹櫣浜捣绗簩鍙n鍓瓕鎶婂鑹插敱浜?);
  const [style, setStyle] = useState('modern-film');
  const [ratio, setRatio] = useState('16:9');
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [storyboardSceneCount, setStoryboardSceneCount] = useState(12);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [pausePoint, setPausePoint] = useState<PausePoint>('critical');
  const [musicMvRhythmMode, setMusicMvRhythmMode] = useState<Task['musicMv']['rhythmMode']>('lyric-sync');
  const [musicMvCaptionStyle, setMusicMvCaptionStyle] = useState<Task['musicMv']['captionStyle']>('karaoke');
  const [musicMvVisualMotif, setMusicMvVisualMotif] = useState('闆ㄥ闇撹櫣銆佸鐙儗褰便€佹參闀滃ご');
  const [musicMvAudioPath, setMusicMvAudioPath] = useState('');
  const [bgmId, setBgmId] = useState(resolveDefaultBgmId(state.config));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const bgmOptions = validBgmItems(state.config);
  const lyricLines = lyrics.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  const musicMvStyleOptions = styleOptions;
  const musicMvDraftTemplateOptions = state.draftTemplates.map((template) => [template.id, template.name, `鍑哄浘 ${template.image.ratio}`]);

  async function selectMusicMvAudio() {
    const audioPath = await api.selectLocalAudio();
    if (!audioPath) return;
    setMusicMvAudioPath(audioPath);
    const nextBgm = addUploadedBgm(state.config, audioPath);
    const next = await api.saveConfig(nextBgm.config);
    applyState(next);
    setBgmId(nextBgm.bgmId);
  }

  async function runMusicMv() {
    if (isBrowserPreview) {
      setMessage('娴忚鍣ㄩ瑙堜笉鑳芥墽琛岀湡瀹炴祦姘寸嚎锛岃鍦?Electron 搴旂敤涓敓鎴愰煶涔?MV銆?);
      return;
    }
    if (!lyrics.trim()) {
      setMessage('璇峰厛杈撳叆姝岃瘝 / 鏂囨銆?);
      return;
    }
    setRunning(true);
    setMessage('');
    try {
      const next = await api.createAndRunTask({
        title,
        inputText: lyrics,
        taskKind: 'music-mv',
        processingMode,
        mode: 'paste',
        track: 'music-mv',
        style,
        ratio,
        templateId,
        bgmId,
        pausePoints: [pausePoint],
        storyboardSceneCount,
        musicMv: {
          rhythmMode: musicMvRhythmMode,
          captionStyle: musicMvCaptionStyle,
          visualMotif: musicMvVisualMotif,
          audioPath: musicMvAudioPath,
        },
      });
      applyState(next);
      const createdTask = next.tasks[0];
      if (createdTask) openTaskDetail(createdTask.id);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="music-mv-layout">
      <section className="task-card">
        <div className="panel-title-row">
          <div>
            <h2>闊充箰MV</h2>
            <span>鎸夋瓕璇嶅垏鍒嗛暅澶淬€佸悓姝ュ瓧骞曡妭濂忥紝骞惰緭鍑哄壀鏄犺崏绋裤€?/span>
          </div>
          <button className="primary-action slim" onClick={runMusicMv} disabled={running || !lyrics.trim()}>
            {running ? <Loader2 className="spin" size={15} /> : <Music size={15} />}
            鐢熸垚闊充箰 MV
          </button>
        </div>

        <Field label="鏍囬">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="姝岃瘝 / 鏂囨">
          <textarea className="source-textarea" value={lyrics} onChange={(event) => setLyrics(event.target.value)} />
        </Field>

        <div className="advanced-grid">
          <Segmented label="鑺傚妯″紡" value={musicMvRhythmMode} options={['lyric-sync', 'fast-cut', 'slow-cinematic']} labels={['姝岃瘝鍚屾', '蹇垏', '鎱㈤暅澶?]} onChange={(value) => setMusicMvRhythmMode(value as Task['musicMv']['rhythmMode'])} />
          <Segmented label="姝岃瘝瀛楀箷" value={musicMvCaptionStyle} options={['karaoke', 'minimal', 'none']} labels={['鍗℃媺 OK', '鏋佺畝', '鏃犲瓧骞?]} onChange={(value) => setMusicMvCaptionStyle(value as Task['musicMv']['captionStyle'])} />
          <Segmented label="澶勭悊妯″紡" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['鍏ㄨ嚜鍔?, '鍗婅嚜鍔?, '鍙嚭鏂规']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
          <Segmented label="鏆傚仠纭" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
          <Segmented label="鍒嗛暅鏁伴噺" value={String(storyboardSceneCount)} options={storyboardSceneCountOptions.map(String)} labels={storyboardSceneCountOptions.map((count) => `${count} 鏉)} onChange={(value) => setStoryboardSceneCount(Number(value))} />
        </div>

        <OptionCloud title="鐢婚潰椋庢牸" options={musicMvStyleOptions} value={style} onChange={setStyle} />
        <div className="option-two-col">
          <OptionCloud title="鑽夌妯℃澘" options={musicMvDraftTemplateOptions} value={templateId} onChange={setTemplateId} />
          <div>
            <span className="field-title">AI 鍑哄浘姣斾緥</span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => setRatio(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="瑙嗚姣嶉">
          <input value={musicMvVisualMotif} onChange={(event) => setMusicMvVisualMotif(event.target.value)} placeholder="渚嬪锛氶洦澶滈湏铏广€佸鐙儗褰便€佹參闀滃ご" />
        </Field>
        <Field label="闊抽鏂囦欢">
          <div className="upload-row">
            <input value={musicMvAudioPath} onChange={(event) => setMusicMvAudioPath(event.target.value)} placeholder="鍙€夋嫨鏈湴姝屾洸鎴栦即濂? />
            <button className="ghost-action" onClick={selectMusicMvAudio}><FolderOpen size={15} />閫夋嫨闊抽</button>
          </div>
        </Field>

        <span className="field-title">鑳屾櫙闊充箰</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>鏃?BGM</button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>
          ))}
        </div>

        {message ? <span className="local-note">{message}</span> : null}
      </section>
      <aside className="music-mv-preview panel">
        <h3>MV 缁撴瀯棰勮</h3>
        <div className="task-metrics">
          <div><small>姝岃瘝琛?/small><strong>{lyricLines.length}</strong></div>
          <div><small>鑺傚</small><strong>{musicMvRhythmMode}</strong></div>
          <div><small>瀛楀箷</small><strong>{musicMvCaptionStyle}</strong></div>
        </div>
        <div className="artifact-scene-list">
          {lyricLines.slice(0, 8).map((line, index) => (
            <div key={`${line}-${index}`}>
              <strong>{index + 1}. {index === 0 ? 'intro' : index === lyricLines.length - 1 ? 'outro' : index >= Math.floor(lyricLines.length / 2) ? 'chorus' : 'verse'}</strong>
              <p>{line}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function QueuePage({
  api,
  state,
  applyState,
  openNewTask,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openNewTask: () => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const latestTask = state.tasks[0];
  const events = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  async function setStatus(task: Task, status: TaskStatus) {
    applyState(await api.updateTaskStatus(task.id, status));
  }
  async function resumeTask(task: Task) {
    applyState(await api.retryTask(task.id));
  }
  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>浠诲姟闃熷垪</h2>
            <span>{state.tasks.length} 涓崏绋?路 閫変腑涓€鎵瑰嵆鍙嚜鍔ㄤ覆琛屾墽琛?路 鍗曚换鍔″唴 3 璺苟鍙戠敓鍥?/span>
          </div>
          <button className="primary-action slim" onClick={openNewTask}>
            <Plus size={15} />
            鏂板缓浠诲姟
          </button>
        </div>
        <div className="task-list">
          {state.tasks.length === 0 ? <EmptyState title="鏆傛棤浠诲姟" /> : null}
          {state.tasks.map((task) => (
            <article className="task-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
              <div>
                <strong>{task.title || '鏈懡鍚嶄换鍔?}</strong>
                <span>{task.mode === 'ai' ? 'AI 鍒涗綔' : '绮樿创鏂囨'} 路 {task.ratio} 路 {formatDate(task.createdAt)}</span>
                <ErrorSummaryButton fullMessage={task.errorMessage} title={task.title || '浠诲姟閿欒'} />
              </div>
              <StatusPill status={task.status} />
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                {task.status === 'running' ? <button className="mini-button" onClick={() => setStatus(task, 'paused')}>鏆傚仠</button> : null}
                {task.status === 'running' || task.status === 'pending' ? <button className="mini-button" onClick={() => setStatus(task, 'cancelled')}>鍙栨秷</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>缁х画</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>閲嶈瘯</button> : null}
                <button className="mini-button" disabled={task.status !== 'completed' || !task.outputDir} onClick={() => task.outputDir && api.openPath(task.outputDir)}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>姝ラ浜嬩欢</h2>
          {latestTask?.status === 'completed' && latestTask.outputDir ? (
            <button className="ghost-action" onClick={() => api.openPath(latestTask.outputDir)}>
              <FolderOpen size={15} />
              鎵撳紑鍓槧鑽夌
            </button>
          ) : null}
        </div>
        <EventTimeline events={events.slice(-24)} />
      </section>
    </div>
  );
}

function HistoryPage({ api, state, openTaskDetail }: { api: StoryDreamApi; state: AppState; openTaskDetail: (taskId: string) => void }) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [query, setQuery] = useState('');
  const tasks = state.tasks.filter((task) => (filter === 'all' || task.status === filter) && `${task.title}${task.inputText}`.includes(query));
  return (
    <section className="panel full-panel">
      <div className="panel-title-row">
        <div className="chip-row">
          {(['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const).map((item) => (
            <button key={item} className={filter === item ? 'chip active' : 'chip'} onClick={() => setFilter(item)}>
              {statusLabel(item)}
            </button>
          ))}
        </div>
        <input className="search-input" value={query} placeholder="鎼滅储浠诲姟" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="history-table">
        <div className="table-head">
          <span>浠诲姟</span>
          <span>鐘舵€?/span>
          <span>姝ラ</span>
          <span>鍒涘缓鏃堕棿</span>
          <span>杈撳嚭</span>
        </div>
        {tasks.length === 0 ? <EmptyState title="鏆傛棤鍘嗗彶浠诲姟" /> : null}
        {tasks.map((task) => (
          <div className="table-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
            <strong>{task.title || '鏈懡鍚嶄换鍔?}</strong>
            <StatusPill status={task.status} />
            <span>{task.currentStep}</span>
            <span>{formatDate(task.createdAt)}</span>
            <button className="mini-button" disabled={!task.outputDir} onClick={(event) => { event.stopPropagation(); if (task.outputDir) api.openPath(task.outputDir); }}>
              <FolderOpen size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  close,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  task: Task | null;
  applyState: (state: AppState) => void;
  close: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<'preview' | 'storyboard' | 'audio'>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const events = task ? state.events.filter((event) => event.taskId === task.id) : [];
  const latestEvent = [...events].reverse()[0] ?? null;
  const snapshotImageCount = artifactSnapshot?.assets.images.length ?? 0;
  const artifactRefreshKey = [
    task?.id ?? '',
    task?.artifactStatePath ?? '',
    task?.outputDir ?? '',
    task?.currentStep ?? '',
    task?.status ?? '',
    latestEvent?.id ?? latestEvent?.seq ?? latestEvent?.ts ?? '',
    snapshotImageCount,
    snapshotStepStatus(artifactSnapshot, 4),
    artifactRefreshTick,
  ].join('|');
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setArtifactRefreshTick((tick) => tick + 1), 1500);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    let cancelled = false;
    if (!task) {
      setArtifactSnapshot(null);
      return undefined;
    }
    const artifactTask = task;
    api.getTaskArtifacts(artifactTask.id)
      .then((snapshot) => {
        if (!cancelled) setArtifactSnapshot(snapshot);
      })
      .catch((error) => {
        if (!cancelled) {
          setArtifactSnapshot({
            available: false,
            message: error instanceof Error ? error.message : String(error),
            taskId: artifactTask.id,
            statePath: artifactTask.artifactStatePath,
            outputDir: artifactTask.outputDir,
            updatedAt: null,
            steps: {},
            artifact: {},
            assets: { cover: [], images: [], narration: [] },
            draft: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifactRefreshKey, task]);
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="鏆傛棤浠诲姟璇︽儏" />
      </section>
    );
  }

  const activeTask = task;
  const currentStep = Math.min(Math.max(activeTask.currentStep, 0), pipelineSteps.length - 1);
  const currentMeta = pipelineSteps[currentStep] ?? pipelineSteps[0];
  const completedSteps = activeTask.status === 'completed' ? pipelineSteps.length : Math.max(0, activeTask.currentStep);

  async function cancelTask() {
    applyState(await api.updateTaskStatus(activeTask.id, 'cancelled'));
  }

  return (
    <div className="task-detail-shell">
      <div className="task-detail-bar">
        <div className="breadcrumb">
          <button onClick={close}>鍘嗗彶浠诲姟</button>
          <span>/</span>
          <strong>浠诲姟璇︽儏</strong>
        </div>
        <button className="mini-button" onClick={close}>
          <XCircle size={14} />
          鍏抽棴
        </button>
      </div>

      <aside className="task-detail-sidebar">
        <section className="task-summary-card">
          <div className="task-id-line">
            <span>{activeTask.id}</span>
            <button className="icon-button" title="澶嶅埗浠诲姟 ID" onClick={() => navigator.clipboard?.writeText(activeTask.id)}>
              <Copy size={14} />
            </button>
          </div>
          <div className="task-metrics">
            <div><strong>{formatDuration(activeTask.createdAt, activeTask.completedAt, liveNow)}</strong><span>鎬昏€楁椂</span></div>
            <div><strong>{completedSteps}<small>/{pipelineSteps.length}</small></strong><span>褰撳墠姝ラ</span></div>
            <div><strong>{events.length || '-'}</strong><span>浜嬩欢鏁?/span></div>
          </div>
          <button className="cancel-task-button" disabled={activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={cancelTask}>
            <XCircle size={14} />
            鍙栨秷浠诲姟
          </button>
        </section>

        <section className="pipeline-card">
          <div className="pipeline-title">
            <strong>7 姝ユ祦姘寸嚎</strong>
            <span className="auto-badge">鍏ㄨ嚜鍔?/span>
            <small>路 鍏ㄩ儴 7 姝ユ墽琛?/small>
          </div>
          <div className="pipeline-list">
            {pipelineSteps.map((step) => {
              const status = pipelineStepStatus(activeTask, step.index);
              const stepEvent = [...events].reverse().find((event) => event.step === step.index);
              const stepLabel = stepEvent?.detail || statusLabelForStep(status);
              return (
                <div className={`pipeline-step ${status}`} key={step.index}>
                  <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.hint}</span>
                    {status === 'running' ? <small>杩涜涓?/small> : stepEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={stepEvent.detail} title={step.title} compact /> : <small>{stepLabel}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="task-detail-main">
        <div className="artifact-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><FileJson size={14} />浜х墿棰勮</button>
          <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}><ImageIcon size={14} />鍒嗛暅鐢诲粖</button>
          <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Mic2 size={14} />閰嶉煶璇曞惉</button>
        </div>
        <ArtifactPreviewContent api={api} task={activeTask} config={state.config} applyState={applyState} tab={tab} snapshot={artifactSnapshot} latestEvent={latestEvent} currentAgent={currentMeta.agent} isBrowserPreview={isBrowserPreview} />
      </section>
    </div>
  );
}

function ArtifactPreviewContent({
  api,
  task,
  config,
  applyState,
  tab,
  snapshot,
  latestEvent,
  currentAgent,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  task: Task;
  config: AppConfig;
  applyState: (state: AppState) => void;
  tab: 'preview' | 'storyboard' | 'audio';
  snapshot: TaskArtifactSnapshot | null;
  latestEvent: TaskEvent | null;
  currentAgent: string;
  isBrowserPreview: boolean;
}) {
  const artifact = snapshot?.artifact ?? {};
  const sourceContext = artifact.sourceContext;
  const scenes = artifact.scenes ?? [];
  const imagePrompts = artifact.imagePrompts ?? [];
  const subtitles = artifact.subtitles;
  const imageAssets = snapshot?.assets.images ?? [];
  const narrationAssets = snapshot?.assets.narration ?? [];
  const imageProgress = imageProgressLabel(scenes.length, imageAssets.length, snapshotStepStatus(snapshot, 4));
  const [rerunningStepAction, setRerunningStepAction] = useState<string | null>(null);
  const canRerunStep = !isBrowserPreview && task.status !== 'running' && task.status !== 'pending' && Boolean(task.artifactStatePath);

  async function rerunArtifactStep(step: number, mode: TaskStepRerunMode) {
    const key = `${step}:${mode}`;
    setRerunningStepAction(key);
    try {
      applyState(await api.rerunTaskStep(task.id, step, mode));
    } finally {
      setRerunningStepAction(null);
    }
  }

  const artifactStepActions = (step: number) => (
    <ArtifactStepActions
      step={step}
      disabled={!canRerunStep}
      regenerating={rerunningStepAction === `${step}:regenerate`}
      rewriting={rerunningStepAction === `${step}:rewrite`}
      onAction={rerunArtifactStep}
    />
  );

  return (
    <div className="artifact-preview">
      <div className="artifact-preview-head">
        <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={22} /> : <Database size={22} />}</div>
        <div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          {latestEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={latestEvent.detail} title="娴佹按绾块敊璇? /> : <span>{snapshot?.message || latestEvent?.detail || '绛夊緟褰撳墠姝ラ浜х墿钀界洏'}</span>}
        </div>
        {task.status === 'completed' && task.outputDir ? (
          <button className="ghost-action" onClick={() => api.openPath(task.outputDir)}>
            <FolderOpen size={15} />
            鎵撳紑鍓槧鑽夌
          </button>
        ) : null}
      </div>

      <div className="preview-meta-grid">
        <div><small>浠诲姟</small><strong>{task.title || '鏈懡鍚嶄换鍔?}</strong></div>
        <div><small>鐘舵€?/small><strong>{statusLabel(task.status)}</strong></div>
        <div><small>褰撳墠浠ｇ悊</small><strong>{currentAgent}</strong></div>
        <div><small>鍥剧墖杩涘害</small><strong>{imageProgress}</strong></div>
        <div><small>浜х墿鏇存柊鏃堕棿</small><strong>{snapshot?.updatedAt ? formatDate(snapshot.updatedAt) : '绛夊緟鐢熸垚'}</strong></div>
        <div><small>杈撳嚭鐩綍</small><strong>{task.outputDir || '绛夊緟鐢熸垚'}</strong></div>
        <div><small>澶辫触姝ラ</small><strong>{task.failedStep ?? '-'}</strong></div>
        <div><small>鐘舵€佹枃浠?/small><strong>{task.artifactStatePath || '绛夊緟鐢熸垚'}</strong></div>
        <div><small>鏈€杩戝績璺?/small><strong>{task.lastHeartbeatAt ? formatDate(task.lastHeartbeatAt) : '绛夊緟杩愯'}</strong></div>
        <div><small>鎭㈠姝ラ</small><strong>{task.retryFromStep ?? '-'}</strong></div>
      </div>

      {tab === 'preview' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="AI 鎼滅储璧勬枡" badge={`${sourceContext?.sections.length ?? 0} 鏉} actions={artifactStepActions(0)}>
            {sourceContext?.sections.length ? (
              <div className="artifact-source-list">
                {sourceContext.sections.map((source, index) => (
                  <div key={`${source.title}-${index}`}>
                    <strong>{source.title}</strong>
                    {source.url ? <span>{source.url}</span> : null}
                    <p>{trimForPreview(source.content || source.snippet || '', 260)}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="绛夊緟 AI 鍒涗綔鎼滅储璧勬枡" />}
          </ArtifactSection>

          <ArtifactSection title="鏂囨棰勫" badge={`${countChars(artifact.reviewedText)} 瀛梎} actions={artifactStepActions(0)}>
            <ArtifactText value={artifact.reviewedText} empty="绛夊緟鏂囨棰勫浜х墿" />
          </ArtifactSection>

          <ArtifactSection title="鏀瑰啓浜х墿" badge={`${countChars(artifact.rewrittenCopy)} 瀛梎} actions={artifactStepActions(1)}>
            <ArtifactText value={artifact.rewrittenCopy} empty="绛夊緟鏀瑰啓浜х墿" />
          </ArtifactSection>

          <ArtifactSection title="灏侀潰淇℃伅" badge={artifact.cover?.title || '绛夊緟鐢熸垚'} actions={artifactStepActions(1)}>
            {artifact.cover ? (
              <div className="artifact-cover-grid">
                <div><small>鏍囬</small><strong>{artifact.cover.title}</strong></div>
                <div><small>鍓爣棰?/small><strong>{artifact.cover.subtitle.join(' / ') || '-'}</strong></div>
                <div><small>鎽樿</small><p>{artifact.cover.summary || '-'}</p></div>
                <div><small>鏍囩</small><p>{artifact.cover.tags.join(' ') || '-'}</p></div>
                <div><small>绉嶅瓙璇勮</small><p>{artifact.cover.comments.join(' / ') || '-'}</p></div>
              </div>
            ) : <ArtifactEmpty text="绛夊緟灏侀潰鏍囬銆佹憳瑕併€佹爣绛惧拰璇勮" />}
          </ArtifactSection>

          <ArtifactSection title="鍒嗛暅鍒嗗彞" badge={`${scenes.length} 鏉} actions={artifactStepActions(2)}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>

          <ArtifactSection title="缁樺浘鎻愮ず璇? badge={`${imagePrompts.length} 鏉} actions={artifactStepActions(3)}>
            <ArtifactPromptList prompts={imagePrompts} />
          </ArtifactSection>

          <ArtifactSection title="鎵归噺鐢熷浘" badge={`${imageAssets.length} 寮燻} actions={artifactStepActions(4)}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>

          <ArtifactSection title="閰嶉煶瀛楀箷" badge={`${narrationAssets.length} 娈?/ ${subtitles?.cues.length ?? 0} 鏉″瓧骞昤} actions={artifactStepActions(5)}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="绛夊緟閰嶉煶鐢熸垚"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.srt ? <pre className="artifact-text-block compact">{trimForPreview(subtitles.srt, 900)}</pre> : null}
          </ArtifactSection>

          <ArtifactSection title="鑽夌杈撳嚭" badge={snapshot?.draft ? '宸茬敓鎴? : '绛夊緟鐢熸垚'} actions={artifactStepActions(6)}>
            {snapshot?.draft ? (
              <div className="artifact-path-list">
                <span>{snapshot.draft.draftDir}</span>
                <span>{snapshot.draft.draftContentPath}</span>
                <span>{snapshot.draft.draftMetaPath}</span>
              </div>
            ) : <ArtifactEmpty text="绛夊緟鍓槧鑽夌鐩綍" />}
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'storyboard' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="鎵归噺鐢熷浘" badge={`${imageAssets.length} 寮燻}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>
          <ArtifactSection title="鍒嗛暅鍒嗗彞" badge={`${scenes.length} 鏉}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'audio' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="閰嶉煶瀛楀箷" badge={`${narrationAssets.length} 娈?/ ${subtitles?.cues.length ?? 0} 鏉″瓧骞昤}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="绛夊緟閰嶉煶鐢熸垚"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.cues.length ? (
              <div className="artifact-scene-list">
                {subtitles.cues.map((cue) => (
                  <div key={cue.index}>
                    <strong>{cue.index}. {formatMs(cue.startMs)} - {formatMs(cue.endMs)}</strong>
                    <p>{cue.text}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="绛夊緟瀛楀箷鏃堕棿杞? />}
          </ArtifactSection>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactSection({ title, badge, actions, children }: { title: string; badge: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="artifact-section">
      <div className="panel-title-row">
        <h3>{title}</h3>
        <div className="artifact-section-actions">
          {actions}
          <small>{badge}</small>
        </div>
      </div>
      {children}
    </section>
  );
}

function ArtifactStepActions({
  step,
  disabled,
  regenerating,
  rewriting,
  onAction,
}: {
  step: number;
  disabled: boolean;
  regenerating: boolean;
  rewriting: boolean;
  onAction: (step: number, mode: TaskStepRerunMode) => void;
}) {
  const busy = regenerating || rewriting;
  return (
    <div className="artifact-step-action-buttons">
      <button className="mini-button" disabled={disabled || busy} title="浠庢湰姝ラ閲嶆柊鐢熸垚锛屽苟缁х画鎵ц鍚庣画姝ラ" onClick={() => onAction(step, 'regenerate')}>
        {regenerating ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
        閲嶆柊鐢熸垚
      </button>
      <button className="mini-button" disabled={disabled || busy} title="鍙傝€冨綋鍓嶄骇鐗╂敼鍐欐湰姝ラ锛屽苟缁х画鎵ц鍚庣画姝ラ" onClick={() => onAction(step, 'rewrite')}>
        {rewriting ? <Loader2 className="spin" size={14} /> : <Wand2 size={14} />}
        鏀瑰啓鍚庣户缁?
      </button>
    </div>
  );
}

function ArtifactText({ value, empty }: { value?: string; empty: string }) {
  return value ? <pre className="artifact-text-block">{value}</pre> : <ArtifactEmpty text={empty} />;
}

function ArtifactEmpty({ text }: { text: string }) {
  return <div className="artifact-empty">{text}</div>;
}

function ArtifactSceneList({
  scenes,
  imagePrompts,
  images,
}: {
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
}) {
  if (scenes.length === 0) return <ArtifactEmpty text="绛夊緟鍒嗛暅鐢熸垚" />;
  return (
    <div className="artifact-scene-list">
      {scenes.map((scene) => {
        const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
        const image = images.find((item) => item.sceneId === scene.id);
        return (
          <div key={scene.id}>
            <strong>{scene.id}. {scene.cap}</strong>
            <p>{scene.descPrompt}</p>
            {prompt ? <small>Prompt: {trimForPreview(prompt.prompt, 220)}</small> : null}
            {image ? <span>{image.path}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ArtifactPromptList({ prompts }: { prompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']> }) {
  if (prompts.length === 0) return <ArtifactEmpty text="绛夊緟缁樺浘鎻愮ず璇? />;
  return (
    <div className="artifact-scene-list">
      {prompts.map((prompt) => (
        <div key={prompt.sceneId}>
          <strong>{prompt.sceneId}. {prompt.cap}</strong>
          <p>{prompt.prompt}</p>
          <small>璐熼潰锛歿prompt.negativePrompt || '-'}</small>
        </div>
      ))}
    </div>
  );
}

function ImageGenerationGallery({
  api,
  task,
  scenes,
  imagePrompts,
  images,
  concurrency,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
  concurrency: number;
  isBrowserPreview: boolean;
  applyState: (state: AppState) => void;
}) {
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const imagePaths = images.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || images.length === 0) {
      setImagePreviewUrls({});
      setImagePreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(images.map((asset) => asset.path));
    setImagePreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setImagePreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of images) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setImagePreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setImagePreviewErrors((current) => ({ ...current, [asset.path]: error instanceof Error ? error.message : String(error) }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, imagePaths, isBrowserPreview]);

  async function regenerate(sceneId: number) {
    setRegeneratingSceneId(sceneId);
    try {
      applyState(await api.regenerateTaskImage(task.id, sceneId));
    } finally {
      setRegeneratingSceneId(null);
    }
  }

  if (scenes.length === 0) return <ArtifactEmpty text="绛夊緟鍒嗛暅鍚庣敓鎴愬浘鐗? />;

  return (
    <div className="image-generation-gallery">
      <div className="image-generation-toolbar">
        <span>骞跺彂鏁?{concurrency}</span>
        <span>{images.length}/{scenes.length} 寮犲凡钀界洏</span>
      </div>
      <div className="image-preview-grid">
        {scenes.map((scene) => {
          const image = images.find((item) => item.sceneId === scene.id);
          const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
          const previewUrl = image ? imagePreviewUrls[image.path] : '';
          const previewError = image ? imagePreviewErrors[image.path] : '';
          return (
            <article className={`image-preview-card ${image ? 'ready' : 'pending'}`} key={scene.id}>
              <div className="image-thumb">
                {previewUrl ? <img src={previewUrl} alt={`Scene ${scene.id}`} /> : null}
                {!previewUrl && image && !previewError ? <span className="thumb-state">璇诲彇涓?/span> : null}
                {!previewUrl && previewError ? <span className="thumb-state danger">璇诲彇澶辫触</span> : null}
                {!image ? <ImageIcon size={24} /> : null}
              </div>
              <div className="image-preview-body">
                <div className="image-preview-title">
                  <strong>{scene.id}. {scene.cap}</strong>
                  <span>{image ? '宸茬敓鎴? : task.status === 'running' ? '绛夊緟/鐢熸垚涓? : '鏈敓鎴?}</span>
                </div>
                <p>{prompt ? trimForPreview(prompt.prompt, 180) : scene.descPrompt}</p>
                {image ? <small>{image.path}</small> : <small>绛夊緟 provider 杩斿洖鐪熷疄鍥剧墖</small>}
                {previewError ? <small className="danger-text">{previewError}</small> : null}
              </div>
              <button
                className="mini-button"
                disabled={isBrowserPreview || task.status === 'running' || task.status === 'pending' || !image || regeneratingSceneId === scene.id}
                onClick={() => regenerate(scene.id)}
              >
                {regeneratingSceneId === scene.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                閲嶆柊鐢熸垚
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function NarrationPreviewList({
  api,
  task,
  scenes,
  subtitles,
  assets,
  empty,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'];
  assets: TaskArtifactSnapshot['assets']['narration'];
  empty: string;
  isBrowserPreview: boolean;
  applyState: (state: AppState) => void;
}) {
  const [audioPreviewUrls, setAudioPreviewUrls] = useState<Record<string, string>>({});
  const [audioPreviewErrors, setAudioPreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const audioPaths = assets.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || assets.length === 0) {
      setAudioPreviewUrls({});
      setAudioPreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(assets.map((asset) => asset.path));
    setAudioPreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setAudioPreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of assets) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setAudioPreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setAudioPreviewErrors((current) => ({ ...current, [asset.path]: error instanceof Error ? error.message : String(error) }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, audioPaths, assets, isBrowserPreview]);

  async function regenerate(sceneId: number) {
    setRegeneratingSceneId(sceneId);
    try {
      applyState(await api.regenerateTaskNarration(task.id, sceneId));
    } finally {
      setRegeneratingSceneId(null);
    }
  }

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const rows = scenes.length
    ? [
        ...scenes.map((scene, index) => ({
          sceneId: scene.id,
          cap: scene.cap,
          cue: subtitles?.cues[index],
          assets: assets.filter((item) => item.sceneId === scene.id).sort(compareNarrationPreviewAssets),
          canRegenerate: true,
        })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({
          sceneId: asset.sceneId,
          cap: '宸茬敓鎴愰厤闊?,
          cue: undefined,
          assets: [asset],
          canRegenerate: false,
        })),
      ]
    : assets.map((asset) => ({
        sceneId: asset.sceneId,
        cap: '宸茬敓鎴愰厤闊?,
        cue: undefined,
        assets: [asset],
        canRegenerate: false,
      }));

  if (rows.length === 0) return <ArtifactEmpty text={empty} />;

  return (
    <div className="narration-preview-list">
      {rows.map((item) => {
        const disabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || regeneratingSceneId === item.sceneId || !item.canRegenerate;
        const ready = item.assets.length > 0;
        return (
          <article className={`narration-preview-card ${ready ? 'ready' : 'pending'}`} key={`${item.sceneId}-${item.assets.map((asset) => asset.path).join('|') || 'pending'}`}>
            <div className="narration-preview-head">
              <div>
                <strong>{item.sceneId}. {item.cap}</strong>
                {item.cue ? <span>{formatMs(item.cue.startMs)} - {formatMs(item.cue.endMs)}</span> : null}
              </div>
              <span>{ready ? `${item.assets.length} 娈靛彲璇曞惉` : task.status === 'running' ? '绛夊緟/鐢熸垚涓? : '鏈敓鎴?}</span>
            </div>
            {item.assets.map((asset, index) => {
              const previewUrl = audioPreviewUrls[asset.path] ?? '';
              const previewError = audioPreviewErrors[asset.path] ?? '';
              return (
                <div className="narration-turn-preview" key={`${asset.path}-${asset.turnIndex ?? index}`}>
                  <strong>{narrationTurnLabel(asset, index)}</strong>
                  {previewUrl ? <audio controls className="narration-player" preload="metadata" src={previewUrl} /> : null}
                  {!previewUrl && !previewError ? <div className="narration-player loading">璇诲彇闊抽涓?/div> : null}
                  {!previewUrl && previewError ? <div className="narration-player error">闊抽璇诲彇澶辫触</div> : null}
                  {asset.text ? <p>{asset.text}</p> : null}
                  <small>{asset.path}</small>
                  {previewError ? <small className="danger-text">{previewError}</small> : null}
                </div>
              );
            })}
            {!ready ? <div className="narration-player loading">绛夊緟闊抽钀界洏</div> : null}
            {item.cue ? <p>{item.cue.text}</p> : null}
            {!ready ? <small>绛夊緟 TTS 杩斿洖鐪熷疄闊抽</small> : null}
            <button className="mini-button" disabled={disabled} onClick={() => regenerate(item.sceneId)}>
              {regeneratingSceneId === item.sceneId ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
              {ready ? '閲嶆柊鐢熸垚閰嶉煶' : '鐢熸垚閰嶉煶'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function compareNarrationPreviewAssets(a: TaskArtifactSnapshot['assets']['narration'][number], b: TaskArtifactSnapshot['assets']['narration'][number]): number {
  const aTurn = a.turnIndex ?? Number.MAX_SAFE_INTEGER;
  const bTurn = b.turnIndex ?? Number.MAX_SAFE_INTEGER;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return a.path.localeCompare(b.path);
}

function narrationTurnLabel(asset: TaskArtifactSnapshot['assets']['narration'][number], index: number): string {
  const speaker = asset.speaker ? `涓绘挱 ${asset.speaker}` : '閰嶉煶';
  const turn = asset.turnIndex ?? index + 1;
  return `${speaker} 路 绗?${turn} 娈礰;
}

function ArtifactImageGallery({
  assets,
  scenes,
  empty,
}: {
  assets: TaskArtifactSnapshot['assets']['images'];
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  empty: string;
}) {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const galleryItems = scenes.length
    ? [
        ...scenes.map((scene) => ({ sceneId: scene.id, cap: scene.cap, asset: assets.find((item) => item.sceneId === scene.id) })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({ sceneId: asset.sceneId, cap: '宸茬敓鎴愬浘鐗?, asset })),
      ]
    : assets.map((asset) => ({ sceneId: asset.sceneId, cap: '宸茬敓鎴愬浘鐗?, asset }));
  if (galleryItems.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-image-gallery">
      {galleryItems.map((item) => {
        const imagePath = item.asset?.path ?? '';
        return (
          <figure className={imagePath ? 'artifact-image-card' : 'artifact-image-card pending'} key={`${item.sceneId}-${imagePath || 'pending'}`}>
            {imagePath ? (
              <img src={toLocalImageUrl(imagePath)} alt={`鍒嗛暅 ${item.sceneId}: ${item.cap}`} loading="lazy" />
            ) : (
              <div className="artifact-image-pending">
                <ImageIcon size={22} />
                <span>绛夊緟鐢熸垚</span>
              </div>
            )}
            <figcaption>
              <strong>{item.sceneId}. {item.cap}</strong>
              <span>{imagePath || '绛夊緟鐢熸垚'}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ArtifactAssetList({ assets, empty }: { assets: TaskArtifactSnapshot['assets']['images']; empty: string }) {
  if (assets.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-path-list">
      {assets.map((asset) => <span key={`${asset.sceneId}-${asset.path}`}>{asset.sceneId}. {asset.path}</span>)}
    </div>
  );
}

function ImageLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [tab, setTab] = useState<'smart' | 'text' | 'reference'>('smart');
  const [smartMode] = useState<ImageLabSmartMode>('podcast-cover');
  const [prompt, setPrompt] = useState('鏍规嵁椋熻氨鍐呭锛岃鍒?2-3 寮犵編椋熸暀绋嬪浘锛屽悎鎴愬搧鍥俱€佺伒榄傛枃妗堛€佸埗浣滄楠わ紝淇濇寔鍙傝€冨浘涓讳綋鍜岃川鎰熴€?);
  const [ratio, setRatio] = useState('9:16');
  const [style, setStyle] = useState('photo-real');
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [referencePasteDraft, setReferencePasteDraft] = useState('');
  const [imageLabOutputCount, setImageLabOutputCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [expandedReferenceImage, setExpandedReferenceImage] = useState('');
  const referenceLimit = 10;
  const referenceCandidates = parseReferenceImagePaths(referenceImagePath);
  const references = referenceCandidates.slice(0, referenceLimit);
  const hiddenReferenceCount = Math.max(0, referenceCandidates.length - references.length);
  const referenceModeDescription = tab === 'smart'
    ? '鏅鸿兘瑙勫垝澶氬紶鍥撅紝鍙甫鍙傝€冨浘锛涢€傚悎鏍规嵁闇€姹傛壒閲忓嚭鏁欑▼鍥俱€佸皝闈㈠拰鍒嗛暅鍥俱€?
    : tab === 'reference'
      ? '鍙傝€冨浘缂栬緫/寤跺睍锛岄渶瑕佸厛娣诲姞鍙傝€冨浘锛涢€傚悎淇濈暀涓讳綋銆佹潗璐ㄥ拰鐢婚潰涓€鑷存€с€?
      : '绾枃鏈敓鎴愬崟寮犲浘锛屼笉浣跨敤鍙傝€冨浘銆?;
  const baseSmartMode: ImageLabSmartMode = tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
  const imageLabRatioChoices = [
    ['21:9', '瀹藉睆'],
    ['16:9', '妯睆'],
    ['3:2', '鏍囧噯妯?],
    ['4:3', '鏍囧噯'],
    ['1:1', '鏂瑰舰'],
    ['3:4', '鏍囧噯绔?],
    ['2:3', '绔栧浘'],
    ['9:16', '绔栧睆'],
  ];
  const estimatedCost = resolution === '1K' ? '0.08' : resolution === '2K' ? '0.16' : '0.32';
  const resolvedSmartMode = resolveImageLabSmartMode(tab, baseSmartMode, references);

  async function selectImageLabReferenceImage() {
    const imagePath = await api.selectLocalImage();
    if (!imagePath) return;
    setReferenceImagePath((current) => [...parseReferenceImagePaths(current), imagePath].join('\n'));
  }

  function removeReferenceImagePath(reference: string) {
    setReferenceImagePath((current) => parseReferenceImagePaths(current).filter((item) => item !== reference).join('\n'));
    if (expandedReferenceImage === reference) {
      setExpandedReferenceImage('');
    }
  }

  function appendReferenceImagePaths(value: string) {
    const nextPaths = parseReferenceImagePaths(value);
    if (!nextPaths.length) return;
    setReferenceImagePath((current) => {
      const merged = [...parseReferenceImagePaths(current), ...nextPaths];
      return Array.from(new Set(merged)).join('\n');
    });
  }

  async function addRecord() {
    if (generating) return;
    setGenerating(true);
    setSubmitError('');
    try {
      const requestedCount = tab === 'text' ? 1 : Math.max(1, Math.min(10, imageLabOutputCount));
      let nextState = state;
      for (let index = 0; index < requestedCount; index += 1) {
        nextState = await api.generateImageLab({
          prompt,
          ratio,
          style,
          resolution,
          smartMode: resolvedSmartMode,
          referenceImagePath: references[0] ?? '',
          referenceImagePaths: references,
        });
      }
      applyState(nextState);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="image-lab-page">
      <section className="panel image-lab-workbench">
        <Segmented label="妯″紡" value={tab} options={['smart', 'text', 'reference']} labels={['鏅烘収鐢熷浘', '鏂囩敓鍥?, '鍥惧儚鍙傝€?]} onChange={(value) => setTab(value as 'smart' | 'text' | 'reference')} />
        <div className="image-lab-mode-note">{referenceModeDescription}</div>
        {tab !== 'text' ? (
          <div className="image-lab-reference-block">
            <div className="image-lab-section-head">
              <strong>鍙傝€冨浘</strong>
              <small>寤鸿缁熶竴 IP 褰㈣薄锛屾渶澶?{referenceLimit} 寮?路 宸查€?{references.length}</small>
            </div>
            <div className="image-lab-dropzone">
              <button className="image-lab-upload-card" type="button" onClick={selectImageLabReferenceImage}>
                <ImageIcon size={18} />
                娣诲姞
              </button>
              <span>
                <strong>閫夋嫨鎴栫矘璐存湰鍦板浘鐗囪矾寰勪綔涓哄弬鑰?/strong>
                <small>鏀寔 PNG / JPG / WEBP锛屾瘡琛屼竴寮狅紝鏈€澶?{referenceLimit} 寮犱細鍙備笌鐢熸垚</small>
              </span>
            </div>
            <textarea
              className="reference-image-list"
              value={referencePasteDraft}
              placeholder="绮樿创鏈湴鍥剧墖璺緞锛屾瘡琛屼竴寮狅紱绮樿创鍚庝笅鏂瑰彧鏄剧ず缂╃暐鍥?
              onPaste={(event) => {
                event.preventDefault();
                appendReferenceImagePaths(event.clipboardData.getData('text'));
                setReferencePasteDraft('');
              }}
              onChange={(event) => setReferencePasteDraft(event.target.value)}
              onBlur={() => {
                appendReferenceImagePaths(referencePasteDraft);
                setReferencePasteDraft('');
              }}
            />
            <div className="image-lab-reference-list" aria-live="polite">
              {references.length ? (
                <div className="image-lab-reference-grid">
                  {references.map((reference, index) => (
                    <article className="image-lab-reference-thumb" key={`${reference}-${index}`}>
                      <button type="button" className="image-lab-reference-image" onClick={() => setExpandedReferenceImage(reference)} aria-label={`鏀惧ぇ鍙傝€冨浘 ${index + 1}`}>
                        <img src={toLocalImageUrl(reference)} alt={`鍙傝€冨浘 ${index + 1}`} loading="lazy" />
                      </button>
                      <div className="image-lab-reference-actions">
                        <button type="button" className="mini-button" onClick={() => setExpandedReferenceImage(reference)}>鏀惧ぇ</button>
                        <button type="button" className="mini-button" onClick={() => removeReferenceImagePath(reference)}>鍒犻櫎</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <span className="image-lab-reference-empty">鏆傛湭娣诲姞鍙傝€冨浘璺緞</span>}
              {hiddenReferenceCount > 0 ? <span className="image-lab-reference-overflow">宸插拷鐣ヨ秴鍑轰笂闄愮殑 {hiddenReferenceCount} 寮?/span> : null}
            </div>
          </div>
        ) : null}
        <Field label="闇€姹傛弿杩?>
          <textarea className="prompt-box image-lab-prompt" value={prompt} placeholder="渚嬪锛氭牴鎹璋卞唴瀹癸紝瑙勫垝 2-3 寮犵編椋熸暀绋嬪浘锛屽悎鎴愬搧鍥俱€佺伒榄傛枃妗堛€佸埗浣滄楠わ紝涓嶈鐐硅禐鍏冪礌" onChange={(event) => setPrompt(event.target.value)} />
        </Field>
        {tab !== 'text' ? (
          <div className="image-lab-slider">
            <div className="image-lab-section-head">
              <strong>鍑哄浘鏁伴噺涓婇檺</strong>
              <small>鏅€氫笂闄愯涓?10 寮?/small>
            </div>
            <input type="range" min={1} max={10} step={1} value={imageLabOutputCount} onChange={(event) => setImageLabOutputCount(Number(event.target.value))} />
            <strong>{imageLabOutputCount} 寮?/strong>
            <small>AI 浼氳鎳傞渶姹傦紝瑙勫垝鎴愭渶澶?10 寮犲浘锛涙瘡寮犲浘鏂囨闇€杩涘浘閲屻€?/small>
          </div>
        ) : null}
        <div className="image-lab-control-group">
          <div className="image-lab-section-head">
            <strong>姣斾緥</strong>
            <small>鍙閫変綋楠屼繚鐣欎负鍗曢€夛紝宸查€?{ratio}</small>
          </div>
          <div className="image-lab-ratio-grid">
            {imageLabRatioChoices.map(([value, label]) => (
              <button key={value} className={ratio === value ? 'selected' : ''} onClick={() => setRatio(value)} type="button">
                <span className={`ratio-icon ratio-${value.replace(':', '-')}`} />
                <strong>{value}</strong>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </div>
        <OptionCloud title="椋庢牸" options={styleOptions} value={style} onChange={setStyle} />
        <Segmented label="鍒嗚鲸鐜? value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as ImageResolution)} />
        <div className="image-lab-footer">
          <button className="primary-action" onClick={addRecord} disabled={generating || !prompt.trim() || (resolvedSmartMode === 'reference-edit' && references.length === 0)}>
            {generating ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
            {generating ? '鐢熸垚涓? : '鏅鸿兘鐢熸垚'}
          </button>
          <div className="provider-line">褰撳墠 Provider锛?strong>{state.config.imageProvider}</strong> 路 {smartImageModeLabel(resolvedSmartMode)} 路 棰勮娑堣€?锟estimatedCost}</div>
        </div>
        {submitError ? <ErrorSummaryButton compact title="鐢诲浘瀹為獙瀹ゆ彁浜ゅけ璐? fullMessage={submitError} /> : null}
      </section>
      {expandedReferenceImage ? (
        <div className="error-dialog-backdrop" onClick={() => setExpandedReferenceImage('')}>
          <section className="error-dialog image-lab-preview-dialog" role="dialog" aria-modal="true" aria-label="鍙傝€冨浘棰勮" onClick={(event) => event.stopPropagation()}>
            <div className="error-dialog-head">
              <strong>鍙傝€冨浘棰勮</strong>
              <button className="mini-button" type="button" onClick={() => setExpandedReferenceImage('')}>鍏抽棴</button>
            </div>
            <img src={toLocalImageUrl(expandedReferenceImage)} alt="鍙傝€冨浘棰勮" />
          </section>
        </div>
      ) : null}
      <section className="image-lab-recent">
        <h3>鏈€杩戠敓鎴?路 {state.imageLabRecords.length}</h3>
        {state.imageLabRecords.length === 0 ? <EmptyState title="鏆傛棤鐢诲浘璁板綍" /> : null}
        <div className="image-grid-panel">
          {state.imageLabRecords.map((record) => (
          <article className={`image-record ${record.status}`} key={record.id}>
            <div className="lab-image-preview">
              {record.imagePath ? <img src={toLocalImageUrl(record.imagePath)} alt={record.prompt} loading="lazy" /> : (
                <>
                  <ImageIcon size={28} />
                  <span>{record.status === 'failed' ? '鐢熸垚澶辫触' : '绛夊緟鍥剧墖'}</span>
                </>
              )}
            </div>
            <strong>{record.prompt}</strong>
            <small>{record.provider} 路 {record.ratio} 路 {record.resolution} 路 {smartImageModeLabel(record.smartMode)} 路 {formatDate(record.createdAt)}</small>
            {record.errorMessage ? <ErrorSummaryButton compact title="鐢熷浘澶辫触" fullMessage={record.errorMessage} /> : null}
          </article>
          ))}
        </div>
      </section>
    </div>
  );

}

function VoiceLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [text, setText] = useState('閰嶉煶瀹為獙瀹よ瘯鍚枃妗堬細鐢ㄧǔ瀹氥€佹竻鏅般€佹湁鎯呯华鐨勫０闊宠瀹岃繖涓€娈垫晠浜嬨€?);
  const [voiceProvider, setVoiceProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const voiceOptions = ttsVoiceOptionsForProvider(voiceProvider);
  const selectedVoiceLabel = taskSpeakerLabel(voiceProvider, voiceId);

  useEffect(() => {
    const options = ttsVoiceOptionsForProvider(voiceProvider);
    if (!options.some((option) => option.id === voiceId)) {
      setVoiceId(defaultTaskSpeakerForProvider(voiceProvider, state.config));
    }
  }, [state.config, voiceId, voiceProvider]);

  function changeProvider(provider: string) {
    const nextProvider = normalizeRuntimeTtsProvider(provider);
    setVoiceProvider(nextProvider);
    setVoiceId(defaultTaskSpeakerForProvider(nextProvider, state.config));
  }

  async function generatePreview() {
    if (generating || !text.trim()) return;
    setGenerating(true);
    setSubmitError('');
    try {
      const next = await api.generateVoiceLabPreview({
        text,
        provider: voiceProvider,
        voiceId,
        voiceLabel: selectedVoiceLabel,
        speed: voiceSpeed,
      });
      applyState(next);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="voice-lab-layout lab-layout">
      <section className="panel">
        <Field label="璇曞惉鏂囨">
          <textarea className="prompt-box voice-lab-text" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <Segmented label="閰嶉煶妯″瀷" value={voiceProvider} options={['volcengine', 'minimax']} labels={['璞嗗寘', 'MiniMax']} onChange={changeProvider} />
        <div className="voice-lab-voices">
          <span className="field-title">闊宠壊</span>
          <div className="chip-row">
            {voiceOptions.map((voice) => (
              <button key={voice.id} className={voiceId === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setVoiceId(voice.id)}>
                <strong>{voice.label}</strong>
                <small>{voice.hint}</small>
              </button>
            ))}
          </div>
        </div>
        <Segmented label="璇€? value={String(voiceSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['鎱㈤€?0.85x', '榛樿 1.0x', '蹇€?1.15x', '鏇村揩 1.3x']} onChange={(value) => setVoiceSpeed(Number(value))} />
        <div className="provider-line">褰撳墠闊宠壊锛歿selectedVoiceLabel} 路 {voiceId}</div>
        {submitError ? <ErrorSummaryButton compact title="閰嶉煶瀹為獙瀹ゆ彁浜ゅけ璐? fullMessage={submitError} /> : null}
        <button className="primary-action" onClick={generatePreview} disabled={generating || !text.trim()}>
          {generating ? <Loader2 className="spin" size={17} /> : <Mic2 size={17} />}
          {generating ? '鐢熸垚涓? : '鐢熸垚璇曞惉'}
        </button>
      </section>
      <section className="panel voice-lab-history">
        <div className="panel-title-row">
          <div>
            <h2>鍘嗗彶璇曞惉</h2>
            <span className="hint-text">{state.voiceLabRecords.length} 鏉℃湰鍦拌褰?/span>
          </div>
        </div>
        {state.voiceLabRecords.length === 0 ? <EmptyState title="鏆傛棤閰嶉煶璇曞惉" /> : null}
        {state.voiceLabRecords.map((record) => (
          <article className={`voice-record ${record.status}`} key={record.id}>
            <div className="voice-record-head">
              <strong>{record.voiceLabel}</strong>
              <small>{record.provider} 路 {record.speed}x 路 {formatDate(record.createdAt)}</small>
            </div>
            <p>{record.text}</p>
            {record.audioPath ? <audio className="voice-lab-player" controls preload="metadata" src={toLocalAssetUrl(record.audioPath)} /> : null}
            {!record.audioPath && record.status === 'failed' ? <div className="voice-lab-player error">鏈敓鎴愰煶棰?/div> : null}
            {record.errorMessage ? <ErrorSummaryButton compact title="閰嶉煶澶辫触" fullMessage={record.errorMessage} /> : null}
            {record.audioPath ? <small>{record.audioPath}</small> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function PromptTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const [templateMode, setTemplateMode] = useState<'gallery' | 'detail' | 'image-detail'>('gallery');
  const [promptTemplateLibraryTab, setPromptTemplateLibraryTab] = useState<'story' | 'image'>('story');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<PromptTemplateType | 'all'>('all');
  const [templateTrackFilter, setTemplateTrackFilter] = useState('all');
  const [selectedImageStyleId, setSelectedImageStyleId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const [imageDraft, setImageDraft] = useState<CustomStyle | null>(state.customStyles[0] ? { ...state.customStyles[0] } : null);
  const [imageTemplateAiPrompt, setImageTemplateAiPrompt] = useState('');
  const [imageTemplateAiStatus, setImageTemplateAiStatus] = useState('');
  const [imageTemplateAiGenerating, setImageTemplateAiGenerating] = useState(false);
  const [baseImageTemplateId, setBaseImageTemplateId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    return typeMatches && trackMatches;
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const selectedImageStyle = state.customStyles.find((style) => style.id === selectedImageStyleId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [templateJsonDraft, setTemplateJsonDraft] = useState('');
  const [imageTemplateJsonDraft, setImageTemplateJsonDraft] = useState('');
  const promptTemplateTrackOptions = buildStoryTemplateTrackOptions(state.promptTemplates);
  const promptTemplateBindingTrackOptions =
    draft?.baseTrack && !promptTemplateTrackOptions.some(([id]) => id === draft.baseTrack)
      ? [...promptTemplateTrackOptions, [draft.baseTrack, draft.baseTrack, '褰撳墠妯℃澘璧涢亾'] as [string, string, string]]
      : promptTemplateTrackOptions;

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);
  useEffect(() => setImageDraft(selectedImageStyle ? { ...selectedImageStyle } : null), [selectedImageStyle?.id]);

  function openPromptTemplateDetail(template: PromptTemplate) {
    setSelectedId(template.id);
    setDraft({ ...template });
    setTemplateJsonDraft('');
    setTemplateMode('detail');
  }

  function openImageTemplateDetail(style: CustomStyle) {
    setSelectedImageStyleId(style.id);
    setImageDraft({ ...style });
    setBaseImageTemplateId(style.id);
    setImageTemplateAiStatus('');
    setTemplateMode('image-detail');
  }

  function handlePromptTemplateRowKeyDown(event: React.KeyboardEvent<HTMLElement>, template: PromptTemplate) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPromptTemplateDetail(template);
  }

  async function savePromptTemplateDraft() {
    if (!draft) return;
    const shouldForkTemplate = Boolean(draft.isBuiltin);
    const templateToSave: PromptTemplate = {
      ...independentPromptTemplateFields(draft),
      id: shouldForkTemplate ? crypto.randomUUID() : draft.id,
      isBuiltin: false,
      origin: 'custom',
      updatedAt: new Date().toISOString(),
    };
    applyState(await api.savePromptTemplate(templateToSave));
    setSelectedId(templateToSave.id);
    setDraft(templateToSave);
    setTemplateMode('detail');
  }

  async function duplicateTemplate(template: PromptTemplate) {
    const copy = { ...independentPromptTemplateFields(template), id: crypto.randomUUID(), name: `${template.name} 鍓湰`, isBuiltin: false, origin: 'custom' as const };
    applyState(await api.savePromptTemplate(copy));
    setSelectedId(copy.id);
    setDraft(copy);
    setTemplateJsonDraft('');
    setTemplateMode('detail');
  }

  async function duplicate() {
    if (!draft) return;
    await duplicateTemplate(draft);
  }

  async function createPromptTemplate() {
    const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter;
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: '鏂板缓妯℃澘',
      type: 'task',
      description: '鏈湴鑷畾涔夋彁绀鸿瘝妯℃澘',
      content: '璇峰熀浜?{{inputText}} 鐢熸垚閫傚悎 {{track}} 鐨勭煭瑙嗛鍐呭銆?,
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      baseTrack,
      defaultStyles: ['photo-real'],
      defaultDraftTemplateId: state.draftTemplates[0]?.id ?? 'default-portrait-9-16',
      characterPolicy: 'follow-template',
      step3SkeletonModules: ['闃插彴璇嶆枃瀛?],
      referenceKind: 'none',
      origin: 'custom',
      marketTags: [],
    };
    applyState(await api.savePromptTemplate(template));
    setSelectedId(template.id);
    setDraft(template);
    setTemplateJsonDraft('');
    setTemplateMode('detail');
  }

  async function saveCustomStyleDraft() {
    if (!imageDraft) return;
    const now = new Date().toISOString();
    const styleToSave = { ...imageDraft, updatedAt: now, createdAt: imageDraft.createdAt || now };
    applyState(await api.saveCustomStyle(styleToSave));
    setSelectedImageStyleId(styleToSave.id);
    setImageDraft(styleToSave);
    setImageTemplateAiStatus('宸蹭繚瀛樺浘鍍忔ā鏉裤€?);
    setTemplateMode('image-detail');
  }

  async function duplicateImageTemplate(style: CustomStyle) {
    const now = new Date().toISOString();
    const copy = { ...style, id: crypto.randomUUID(), name: `${style.name} 鍓湰`, createdAt: now, updatedAt: now };
    applyState(await api.saveCustomStyle(copy));
    setSelectedImageStyleId(copy.id);
    setImageDraft(copy);
    setImageTemplateAiStatus('宸插厠闅嗗浘鍍忔ā鏉裤€?);
    setTemplateMode('image-detail');
  }

  async function createImageTemplate() {
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
    const now = new Date().toISOString();
    const template: CustomStyle = {
      ...base,
      id: crypto.randomUUID(),
      name: '鏂板缓鍥惧儚妯℃澘',
      tag: '鑷畾涔夐鏍?,
      shortName: '鑷畾涔?,
      createdAt: now,
      updatedAt: now,
    };
    applyState(await api.saveCustomStyle(template));
    setSelectedImageStyleId(template.id);
    setImageDraft(template);
    setImageTemplateAiStatus('');
    setTemplateMode('image-detail');
  }

  function applyBaseImageTemplate() {
    if (!imageDraft) return;
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    if (!base) return;
    setImageDraft({
      ...imageDraft,
      tag: base.tag,
      shortName: base.shortName,
      prefix: base.prefix,
      suffix: base.suffix,
      negativePrompt: base.negativePrompt,
      allowColor: base.allowColor,
      description: base.description,
    });
    setImageTemplateAiStatus(`宸插鐢ㄧ郴缁熼鏍硷細${base.name}`);
  }

  async function fillImageTemplateFromAiPrompt() {
    if (!imageDraft) return;
    const prompt = imageTemplateAiPrompt.trim();
    if (!prompt) {
      setImageTemplateAiStatus('璇峰厛杈撳叆椋庢牸鎻忚堪銆?);
      return;
    }
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    setImageTemplateAiGenerating(true);
    setImageTemplateAiStatus('姝ｅ湪鐢熸垚瀛楁...');
    try {
      const generated = await api.generateCustomStyleDraft({ prompt, baseStyle: base ?? imageDraft });
      setImageDraft({ ...imageDraft, ...generated, id: imageDraft.id, createdAt: imageDraft.createdAt });
      setImageTemplateAiStatus(`宸茬敓鎴愬瓧娈碉細${generated.name || prompt}`);
    } catch (error) {
      setImageTemplateAiStatus(`鐢熸垚澶辫触锛?{error instanceof Error ? error.message : '璇锋鏌?LLM 閰嶇疆鍚庨噸璇曘€?}`);
    } finally {
      setImageTemplateAiGenerating(false);
    }
  }

  function exportPromptTemplateJson() {
    if (!draft) return;
    const json = JSON.stringify(draft, null, 2);
    setTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function exportImageTemplateJson() {
    if (!imageDraft) return;
    const json = JSON.stringify(imageDraft, null, 2);
    setImageTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function resolveImportedTemplateId(imported: { id?: string }, exists: boolean): string {
    return imported.id && !exists ? imported.id : crypto.randomUUID();
  }

  async function importPromptTemplateJson() {
    try {
      const imported = JSON.parse(templateJsonDraft) as PromptTemplate;
      const id = resolveImportedTemplateId(imported, state.promptTemplates.some((template) => template.id === imported.id));
      const next = { ...imported, id, isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      setSelectedId(next.id);
      setDraft(next);
      setTemplateMode('detail');
      setTemplateJsonDraft('');
    } catch {
      setTemplateJsonDraft('{"name":"鑷畾涔夋ā鏉?,"type":"task","description":"璇疯ˉ鍏?,"content":"璇疯ˉ鍏呮彁绀鸿瘝"}');
    }
  }

  async function importImageTemplateJson() {
    try {
      const imported = JSON.parse(imageTemplateJsonDraft) as CustomStyle;
      const now = new Date().toISOString();
      const id = resolveImportedTemplateId(imported, state.customStyles.some((style) => style.id === imported.id));
      const next: CustomStyle = {
        ...imported,
        id,
        createdAt: imported.createdAt || now,
        updatedAt: now,
      };
      applyState(await api.saveCustomStyle(next));
      setSelectedImageStyleId(next.id);
      setImageDraft(next);
      setTemplateMode('image-detail');
      setImageTemplateJsonDraft('');
    } catch {
      setImageTemplateJsonDraft('{"name":"鑷畾涔夊浘鍍忔ā鏉?,"tag":"鑷畾涔?,"shortName":"鑷畾涔?,"prefix":"璇疯ˉ鍏?,"suffix":"璇疯ˉ鍏?,"negativePrompt":"璇疯ˉ鍏?,"allowColor":true,"description":"璇疯ˉ鍏?}');
    }
  }

  function updatePromptTemplateStepPrompt(type: PromptStepTemplateType, content: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        stepPrompts: {
          ...(current.stepPrompts ?? {}),
          [type]: content,
        },
      };
    });
  }

  function resetPromptTemplateStepPrompt(type: PromptStepTemplateType) {
    setDraft((current) => {
      if (!current?.stepPrompts) return current;
      const nextStepPrompts = { ...current.stepPrompts };
      delete nextStepPrompts[type];
      return {
        ...current,
        stepPrompts: Object.keys(nextStepPrompts).length > 0 ? nextStepPrompts : undefined,
      };
    });
  }

  if (templateMode === 'gallery') {
    return (
      <div className="prompt-template-gallery">
        <div className="panel-title-row prompt-template-gallery-toolbar">
          <div>
            <h2>鎻愮ず璇嶆ā鏉?/h2>
            <p>鏁呬簨妯℃澘鍐冲畾 AI 鎬庝箞鍐欙紝鍥惧儚妯℃澘鍐冲畾鐢婚潰鎬庝箞闀裤€傚厛娴忚妯℃澘锛岀偣寮€鍚庢煡鐪嬪拰缂栬緫缁嗚妭銆?/p>
          </div>
          <div className="button-row">
            <button className="ghost-action" onClick={async () => applyState(await api.resetPromptTemplates())}>
              <RotateCcw size={14} />
              閲嶇疆
            </button>
            <button className="primary-action slim" onClick={promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate}>
              <Plus size={14} />
              鏂板缓妯℃澘
            </button>
          </div>
        </div>
        <div className="prompt-template-tabs" role="tablist" aria-label="鎻愮ず璇嶆ā鏉跨被鍨?>
          <button className={promptTemplateLibraryTab === 'story' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('story')}>鏁呬簨妯℃澘</button>
          <button className={promptTemplateLibraryTab === 'image' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('image')}>鍥惧儚妯℃澘</button>
        </div>
        {promptTemplateLibraryTab === 'story' ? (
          <>
            <div className="template-filter-row">
              <Field label="绫诲瀷绛涢€?>
                <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}>
                  {promptTemplateTypeOptions.map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                </select>
              </Field>
              <Field label="璧涢亾绛涢€?>
                <select value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}>
                  <option value="all">鍏ㄩ儴璧涢亾</option>
                  {promptTemplateTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            <section className="prompt-template-list story-template-gallery">
              <div className="prompt-template-list-title">
                <strong>鏁呬簨妯℃澘锛坽filteredTemplates.filter((template) => template.type === 'task').length}锛?/strong>
                <span>{filteredTemplates.length} 涓尮閰嶆ā鏉?/span>
              </div>
              {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
                <article
                  className="prompt-template-row"
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openPromptTemplateDetail(template)}
                  onKeyDown={(event) => handlePromptTemplateRowKeyDown(event, template)}
                >
                  <Sparkles size={18} />
                  <div className="prompt-template-row-main">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>榛樿鍥惧儚妯℃澘锛歿promptTemplateStyleLabelList(template, state.customStyles).join('銆?) || '鏈缃?} 路 id: {template.id}</small>
                  </div>
                  <div className="prompt-template-row-actions">
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openPromptTemplateDetail(template); }}>
                      鏌ョ湅
                    </button>
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateTemplate(template); }}>
                      <Copy size={14} />
                      鍏嬮殕
                    </button>
                  </div>
                </article>
              )) : <EmptyState title="鏆傛棤鍖归厤妯℃澘" />}
            </section>
          </>
        ) : (
          <section className="prompt-template-list image-template-gallery">
            <div className="prompt-template-list-title">
              <strong>鍥惧儚妯℃澘锛坽state.customStyles.length}锛?/strong>
              <span>绠＄悊 prefix銆乻uffix銆佽礋闈㈡彁绀鸿瘝鍜岃壊褰╂ā寮?/span>
            </div>
            {state.customStyles.map((style) => (
              <article
                className="prompt-template-row"
                key={style.id}
                role="button"
                tabIndex={0}
                onClick={() => openImageTemplateDetail(style)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImageTemplateDetail(style);
                  }
                }}
              >
                <Palette size={18} />
                <div className="prompt-template-row-main">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                  <small>{style.tag} 路 {style.allowColor ? '褰╄壊' : '榛戠櫧 / 鍗曡壊'} 路 id: {style.id}</small>
                </div>
                <div className="prompt-template-row-actions">
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openImageTemplateDetail(style); }}>
                    鏌ョ湅
                  </button>
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateImageTemplate(style); }}>
                    <Copy size={14} />
                    鍏嬮殕
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    );
  }

  if (templateMode === 'image-detail') {
    return (
      <div className="prompt-template-detail">
        <section className="panel editor-panel">
          {imageDraft ? (
            <>
              <div className="panel-title-row prompt-template-detail-title">
                <div>
                  <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>杩斿洖妯℃澘搴?/button>
                  <h2>鏌ョ湅鍥惧儚妯℃澘 路 {imageDraft.name}</h2>
                </div>
                <div className="button-row">
                  <button className="ghost-action" onClick={() => void duplicateImageTemplate(imageDraft)}>
                    <Copy size={15} />
                    鍏嬮殕
                  </button>
                  <button className="ghost-action" onClick={exportImageTemplateJson}>
                    <FileJson size={15} />
                    瀵煎嚭 JSON
                  </button>
                  <button className="ghost-action" onClick={() => void importImageTemplateJson()}>
                    <FileJson size={15} />
                    瀵煎叆 JSON
                  </button>
                  <button className="primary-action slim" onClick={saveCustomStyleDraft}>
                    <Save size={15} />
                    淇濆瓨
                  </button>
                </div>
              </div>
              <div className="prompt-template-detail-stack">
                <section className="image-template-quick-card">
                  <div>
                    <span className="field-title">AI 蹇€熺敓鎴?/span>
                    <span className="hint-text">杈撳叆鑷劧璇█鎻忚堪锛岃嚜鍔ㄥ～鍏呬笅鏂瑰浘鍍忔ā鏉垮瓧娈点€?/span>
                  </div>
                  <Field label="椋庢牸鎻忚堪">
                    <textarea className="small-textarea" value={imageTemplateAiPrompt} onChange={(event) => setImageTemplateAiPrompt(event.target.value)} placeholder="渚嬪锛氳禌鍗氭湅鍏嬮洦澶滆閬擄紝闇撹櫣鍏夊奖锛屾湭鏉ラ兘甯? />
                  </Field>
                  <div className="template-meta-grid">
                    <Field label="鍩轰簬绯荤粺椋庢牸">
                      <select value={baseImageTemplateId} onChange={(event) => setBaseImageTemplateId(event.target.value)}>
                        {state.customStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                      </select>
                    </Field>
                    <div className="button-row image-template-quick-actions">
                      <button className="ghost-action" type="button" onClick={applyBaseImageTemplate}>濂楃敤绯荤粺椋庢牸</button>
                      <button className="primary-action slim" type="button" disabled={imageTemplateAiGenerating} onClick={() => void fillImageTemplateFromAiPrompt()}>
                        {imageTemplateAiGenerating ? '鐢熸垚涓?..' : '鐢熸垚瀛楁'}
                      </button>
                    </div>
                  </div>
                  {imageTemplateAiStatus ? <div className="image-template-ai-status" aria-live="polite">{imageTemplateAiStatus}</div> : null}
                </section>

                <section className="prompt-template-settings-card">
                  <span className="field-title">鎵嬪姩濉啓瀛楁</span>
                  <div className="image-template-field-grid">
                    <Field label="鍚嶇О">
                      <input value={imageDraft.name} onChange={(event) => setImageDraft({ ...imageDraft, name: event.target.value })} />
                    </Field>
                    <Field label="鏍囩">
                      <input value={imageDraft.tag} onChange={(event) => setImageDraft({ ...imageDraft, tag: event.target.value })} />
                    </Field>
                    <Field label="绠€绉?>
                      <input value={imageDraft.shortName} onChange={(event) => setImageDraft({ ...imageDraft, shortName: event.target.value })} />
                    </Field>
                    <Field label="鑹插僵妯″紡">
                      <select value={imageDraft.allowColor ? 'color' : 'mono'} onChange={(event) => setImageDraft({ ...imageDraft, allowColor: event.target.value === 'color' })}>
                        <option value="color">褰╄壊</option>
                        <option value="mono">榛戠櫧 / 鍗曡壊</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="鍓嶇紑锛坧refix锛?>
                    <textarea className="small-textarea" value={imageDraft.prefix} onChange={(event) => setImageDraft({ ...imageDraft, prefix: event.target.value })} />
                  </Field>
                  <Field label="鍚庣紑锛坰uffix锛?>
                    <textarea className="small-textarea" value={imageDraft.suffix} onChange={(event) => setImageDraft({ ...imageDraft, suffix: event.target.value })} />
                  </Field>
                  <Field label="璐熼潰鎻愮ず璇嶏紙negativePrompt锛?>
                    <textarea className="small-textarea" value={imageDraft.negativePrompt} onChange={(event) => setImageDraft({ ...imageDraft, negativePrompt: event.target.value })} />
                  </Field>
                  <Field label="閫傜敤鍦烘櫙鎻忚堪">
                    <textarea className="small-textarea" value={imageDraft.description} onChange={(event) => setImageDraft({ ...imageDraft, description: event.target.value })} />
                  </Field>
                </section>
                <Field label="瀵煎叆 / 瀵煎嚭 JSON">
                  <textarea className="small-textarea" value={imageTemplateJsonDraft} onChange={(event) => setImageTemplateJsonDraft(event.target.value)} placeholder="瀵煎嚭鍚庝細濉叆杩欓噷锛涗篃鍙矘璐村浘鍍忔ā鏉?JSON 鍚庣偣鍑诲鍏?JSON" />
                </Field>
              </div>
            </>
          ) : (
            <EmptyState title="鏆傛棤鍥惧儚妯℃澘" />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="prompt-template-detail">
      <section className="panel editor-panel">
        {draft ? (
          <>
            <div className="panel-title-row prompt-template-detail-title">
              <div>
                <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>杩斿洖妯℃澘搴?/button>
                <h2>鏌ョ湅绯荤粺妯℃澘 路 {draft.name}</h2>
              </div>
              <div className="button-row">
                <button className="ghost-action" onClick={duplicate}>
                  <Copy size={15} />
                  鍏嬮殕
                </button>
                <button className="ghost-action" onClick={exportPromptTemplateJson}>
                  <FileJson size={15} />
                  瀵煎嚭 JSON
                </button>
                <button className="ghost-action" onClick={() => void importPromptTemplateJson()}>
                  <FileJson size={15} />
                  瀵煎叆 JSON
                </button>
                <button className="primary-action slim" onClick={savePromptTemplateDraft}>
                  <Save size={15} />
                  {draft.isBuiltin ? '淇濆瓨涓鸿嚜瀹氫箟妯℃澘' : '淇濆瓨淇敼'}
                </button>
              </div>
            </div>
            <div className="prompt-template-detail-stack">
              <section className="prompt-template-basics-card">
                <div className="template-meta-grid prompt-template-basics-grid">
                  <Field label="妯℃澘鍚?>
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </Field>
                  <Field label="鎻忚堪锛堜竴鍙ヨ瘽璇存槑杩欎釜妯℃澘鐨勭壒鐐癸級">
                    <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  </Field>
                  <Field label="妯℃澘绫诲瀷">
                    <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}>
                      {promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                    </select>
                  </Field>
                  <Field label="缁戝畾璧涢亾">
                    <select value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}>
                      <option value="">鏃?/option>
                      {promptTemplateBindingTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="prompt-template-default-style-pills">
                  <span className="field-title">榛樿鐢婚</span>
                  <div className="chip-row">
                    {promptTemplateStyleOptions(state.customStyles, draft).map((style) => (
                      <button
                        className={resolvePromptTemplateDefaultStyleId(draft, state.customStyles.map((customStyle) => customStyle.id)) === style.id ? 'chip active' : 'chip'}
                        type="button"
                        key={style.id}
                        onClick={() => setDraft({ ...draft, defaultStyles: [style.id] })}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.type === 'task' ? (
                  <div className="prompt-template-default-style-pills">
                    <span className="field-title">榛樿鑽夌妯℃澘</span>
                    <div className="chip-row">
                      {state.draftTemplates.map((template) => (
                        <button
                          className={(draft.defaultDraftTemplateId ?? 'default-portrait-9-16') === template.id ? 'chip active' : 'chip'}
                          type="button"
                          key={template.id}
                          onClick={() => setDraft({ ...draft, defaultDraftTemplateId: template.id })}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                    <small>鏂板缓浠诲姟閫夋嫨璧涢亾鍚庯紝浼氬悓姝ヨ崏绋挎ā鏉匡紝骞舵妸 AI 鍑哄浘姣斾緥鍚屾涓鸿鑽夌鐨勫浘鐗囨瘮渚嬨€?/small>
                  </div>
                ) : null}
              </section>

              <section className="prompt-template-settings-card">
                <span className="field-title">璁剧疆鍐呭</span>
                <div className="prompt-template-content-settings">
                  <div className="prompt-template-setting-block">
                    <strong>涓昏妗ｆ</strong>
                    <div className="chip-row">
                      {(['follow-template', 'force-extract', 'force-skip'] as const).map((policy) => (
                        <button className={draft.characterPolicy === policy ? 'chip active' : 'chip'} type="button" key={policy} onClick={() => setDraft({ ...draft, characterPolicy: policy })}>
                          {policy === 'force-extract' ? '寮哄埗鎻愬彇' : policy === 'force-skip' ? '寮哄埗璺宠繃' : '璺熼殢璧涢亾'}
                        </button>
                      ))}
                    </div>
                    <small>涓昏妗ｆ浼氬奖鍝?Step 3 鏄惁淇濇寔浜虹墿韬唤銆佸璨屻€佸勾浠ｅ拰鍙欎簨涓€鑷淬€?/small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>Step 3 楠ㄦ灦妯″潡锛堝彲閫夌嚎璺級</strong>
                    <div className="chip-row">
                      {promptTemplateStep3SkeletonOptions.map((module) => (
                        <button
                          className={(draft.step3SkeletonModules ?? []).includes(module) ? 'chip active' : 'chip'}
                          type="button"
                          key={module}
                          onClick={() => setDraft({ ...draft, step3SkeletonModules: toggleArray(draft.step3SkeletonModules ?? [], module) })}
                        >
                          {module}
                        </button>
                      ))}
                    </div>
                    <small>鍕鹃€夊悗 AI 鍔╂墜浼氭寜鐢ㄩ€旂敓鎴愬搴旈鏋讹紝宸蹭繚瀛樼殑 Step 3 prompt 鏂囨湰涓嶄細鑷姩鏀瑰彉銆?/small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>鍙傝€冨浘绫诲瀷</strong>
                    <div className="chip-row">
                      {promptTemplateReferenceOptions.map(([value, label]) => (
                        <button className={(draft.referenceKind ?? 'none') === value ? 'chip active' : 'chip'} type="button" key={value} onClick={() => setDraft({ ...draft, referenceKind: value })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>涓婁紶鍙傝€冨浘鏃讹紝Step 3 浼氭寜杩欓噷鐨勭被鍨嬪喅瀹氫汉鑴告垨浜у搧涓€鑷存€ц姹傘€?/small>
                  </div>
                </div>
                <div className="prompt-template-advanced-grid">
                  <Field label="鏍囩">
                    <input value={(draft.marketTags ?? []).join('銆?)} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
                  </Field>
                  {draft.type === 'task' ? (
                    <Field label="鍑哄浘绉嶅瓙姹?JSON">
                      <textarea
                        className="small-textarea prompt-template-seed-pools"
                        value={draft.imageSeedPoolsJson ?? ''}
                        onChange={(event) => setDraft({ ...draft, imageSeedPoolsJson: event.target.value })}
                        placeholder='{"scenes":["close-up","wide shot"],"moods":["warm","dramatic"]}'
                      />
                    </Field>
                  ) : null}
                </div>
              </section>

              <span className="local-note">{draft.isBuiltin ? '绯荤粺妯℃澘淇濆瓨鍚庝細鐢熸垚鑷畾涔夊壇鏈紝鍘熺郴缁熸ā鏉夸繚鎸佷笉鍙樸€? : '鑷畾涔夋ā鏉夸繚瀛樹細鏇存柊褰撳墠妯℃澘锛屽巻鍙蹭换鍔″拰宸茬粦瀹氶厤缃細缁х画浣跨敤杩欎釜妯℃澘銆?}</span>

              {draft.type === 'task' ? (
                <section className="prompt-step-editor-list" aria-label="AI 姝ラ璁剧疆">
                  <div className="prompt-step-editor-heading">
                    <span className="field-title prompt-step-editor-section-title">姝ラ榛樿鎻愮ず璇?/span>
                  </div>
                  <article className="prompt-step-editor-card" key="task-template-content">
                    <div className="prompt-step-editor-card-header">
                      <div>
                        <strong>浠诲姟鎬绘寚浠?/strong>
                        <small>瀹氫箟褰撳墠浠诲姟妯℃澘鐨勬暣浣撶洰鏍囥€佽禌閬撹姘斿拰鍐呭杈圭晫</small>
                      </div>
                    </div>
                    <PromptVariablePicker scope="task" value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                    <VariableAwareTextarea
                      className="template-textarea prompt-step-editor-textarea"
                      value={draft.content}
                      onChange={(value) => setDraft({ ...draft, content: value })}
                      placeholder="杈撳叆 // 閫夋嫨鍙橀噺"
                      variables={promptTemplateVariablesForScope('task')}
                    />
                  </article>
                  {promptStepEditorDefinitions.map((step) => {
                    const hasOverride = promptTemplateHasStepPrompt(draft, step.type);
                    return (
                      <article className="prompt-step-editor-card" key={step.type}>
                        <div className="prompt-step-editor-card-header">
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.hint}</small>
                          </div>
                          <button className="ghost-action compact-action" type="button" disabled={!hasOverride} onClick={() => resetPromptTemplateStepPrompt(step.type)}>
                            缁ф壙鍏ㄥ眬
                          </button>
                        </div>
                        <VariableAwareTextarea
                          className="template-textarea prompt-step-editor-textarea"
                          value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                          onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          placeholder="杈撳叆 // 閫夋嫨鍙橀噺"
                          variables={promptTemplateVariablesForScope(step.type)}
                        />
                      </article>
                    );
                  })}
                </section>
              ) : (
                <section className="prompt-template-settings-card">
                  <div className="prompt-template-section-heading">
                    <span className="field-title">鎻愮ず璇嶅唴瀹?/span>
                  </div>
                  <PromptVariablePicker scope={draft.type} value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                  <VariableAwareTextarea
                    className="template-textarea"
                    value={draft.content}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                    placeholder="杈撳叆 // 閫夋嫨鍙橀噺"
                    variables={promptTemplateVariablesForScope(draft.type)}
                  />
                </section>
              )}
            </div>
            <Field label="瀵煎叆 / 瀵煎嚭 JSON">
              <textarea className="small-textarea" value={templateJsonDraft} onChange={(event) => setTemplateJsonDraft(event.target.value)} placeholder="瀵煎嚭鍚庝細濉叆杩欓噷锛涗篃鍙矘璐存晠浜嬫ā鏉?JSON 鍚庣偣鍑诲鍏?JSON" />
            </Field>
          </>
        ) : (
          <EmptyState title="鏆傛棤妯℃澘" />
        )}
      </section>
    </div>
  );
}

function insertPromptVariable(value: string, key: string, cursor: number): { value: string; cursor: number } {
  const token = `{{${key}}}`;
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const triggerIndex = before.lastIndexOf('//');
  if (triggerIndex >= 0 && before.slice(triggerIndex).trim() === '//') {
    const nextValue = `${value.slice(0, triggerIndex)}${token}${after}`;
    return { value: nextValue, cursor: triggerIndex + token.length };
  }
  const prefix = before.endsWith(' ') || before.endsWith('\n') || before.length === 0 ? '' : ' ';
  const nextValue = `${before}${prefix}${token}${after}`;
  return { value: nextValue, cursor: before.length + prefix.length + token.length };
}

function promptTemplateVariablesForScope(scope: PromptTemplateVariableScope) {
  return promptTemplateVariableDefinitions.filter((item) => item.scopes.includes(scope));
}

function appendPromptVariable(value: string, key: string): string {
  return insertPromptVariable(value, key, value.length).value;
}

function PromptVariablePicker({
  scope,
  value,
  onChange,
}: {
  scope: PromptTemplateVariableScope;
  value: string;
  onChange: (value: string) => void;
}) {
  const variables = promptTemplateVariablesForScope(scope);
  return (
    <>
      <span className="field-title">鍙橀噺</span>
      <span className="hint-text">鐐瑰嚮鎻掑叆褰撳墠姝ラ鍙敤鍙橀噺锛涙瘡涓彁绀鸿瘝杈撳叆妗嗕篃鍙緭鍏?// 閫夋嫨鍙橀噺銆?/span>
      <div className="variable-chip-row">{variables.map((item) => (
        <button
          className="chip prompt-template-variable-chip"
          type="button"
          key={item.key}
          title={`鎻掑叆 {{${item.key}}}: ${item.description}`}
          onClick={() => onChange(appendPromptVariable(value, item.key))}
        >
          <span>{item.label}</span>
          <code className="prompt-variable-token">{`{{${item.key}}}`}</code>
          <small>{item.description}</small>
        </button>
      ))}</div>
    </>
  );
}

function VariableAwareTextarea({
  value,
  onChange,
  className,
  placeholder,
  variables,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  variables: typeof promptTemplateVariableDefinitions;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  function syncSuggestState(nextValue: string, cursor: number | null) {
    const beforeCursor = nextValue.slice(0, cursor ?? nextValue.length);
    setSuggestOpen(beforeCursor.endsWith('//'));
  }

  function onVariableInsert(key: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const next = insertPromptVariable(value, key, cursor);
    onChange(next.value);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  return (
    <div className="prompt-variable-editor">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncSuggestState(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
      />
      {suggestOpen ? (
        <div className="prompt-variable-suggest">
          {variables.map((item) => (
            <button type="button" key={item.key} onMouseDown={(event) => event.preventDefault()} onClick={() => onVariableInsert(item.key)}>
              <span>{item.label}</span>
              <code>{`{{${item.key}}}`}</code>
              <small>鑻辨枃鍙橀噺 路 {item.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DraftTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = editingId ? state.draftTemplates.find((template) => template.id === editingId) ?? null : null;
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<DraftCanvasLayer>('title');
  const [effectCatalog, setEffectCatalog] = useState<JianyingEffectCatalog>(fallbackEffectCatalog);
  const [cozeWorkflowSource, setCozeWorkflowSource] = useState('');
  const [cozeImportName, setCozeImportName] = useState('');
  const [cozeImportResult, setCozeImportResult] = useState<Extract<CozeWorkflowTemplateConversionResult, { ok: true }> | null>(null);
  const [cozeImportResults, setCozeImportResults] = useState<CozeWorkflowTemplateConversionResult[]>([]);
  const [cozeImportError, setCozeImportError] = useState('');
  const [cozeImportOpen, setCozeImportOpen] = useState(false);

  useEffect(() => {
    // Rehydrate only when switching templates; state refreshes must not overwrite unsaved drag edits.
    const currentEditingTemplate = state.draftTemplates.find((template) => template.id === editingId) ?? null;
    setDraft(currentEditingTemplate ? cloneDraftTemplate(currentEditingTemplate) : null);
  }, [editingId]);

  useEffect(() => {
    let disposed = false;
    api
      .getJianyingEffectCatalog()
      .then((catalog) => {
        if (!disposed) setEffectCatalog(catalog);
      })
      .catch(() => {
        if (!disposed) setEffectCatalog(fallbackEffectCatalog);
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  useEffect(() => {
    if (!draft || isDraftLayerVisible(draft, selectedLayer)) return;
    setSelectedLayer(firstVisibleDraftLayer(draft));
  }, [draft, selectedLayer]);

  async function save() {
    if (draft) applyState(await api.saveDraftTemplate(draft));
  }

  async function copyTemplate(template: DraftTemplate) {
    const copy = { ...cloneDraftTemplate(template), id: crypto.randomUUID(), name: `${template.name} 鍓湰`, isDefault: false };
    applyState(await api.saveDraftTemplate(copy));
    setEditingId(copy.id);
  }

  async function createTemplate() {
    const base = cloneDraftTemplate(builtinDraftTemplates[0]);
    const next = { ...base, id: crypto.randomUUID(), name: '鏂版ā鏉?, isDefault: false };
    applyState(await api.saveDraftTemplate(next));
    setEditingId(next.id);
  }

  function previewCozeWorkflowTemplate() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    const result = results[0] ?? convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    setCozeImportResults(results);
    if (!result.ok || results.some((item) => !item.ok)) {
      setCozeImportResult(null);
      setCozeImportError(!result.ok ? result.error : '閮ㄥ垎 Coze 宸ヤ綔娴佽浆鎹㈠け璐ワ紝璇锋鏌ユ簮鐮併€?);
      return;
    }
    setCozeImportResult(result);
    setCozeImportError('');
    if (!cozeImportName.trim()) setCozeImportName(result.template.name);
  }

  async function saveCozeWorkflowTemplate() {
    const result = convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    if (!result.ok) {
      setCozeImportResult(null);
      setCozeImportError(result.error);
      return;
    }
    const template = cozeImportName.trim() ? { ...result.template, name: cozeImportName.trim() } : result.template;
    applyState(await api.saveDraftTemplate(template));
    setCozeImportResult({ ...result, template });
    setCozeImportError('');
    setEditingId(template.id);
  }

  async function saveAllCozeWorkflowTemplates() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    setCozeImportResults(results);
    const failures = results.filter((result) => !result.ok);
    if (failures.length) {
      setCozeImportResult(null);
      setCozeImportError(`${failures.length} 涓?Coze 宸ヤ綔娴佽浆鎹㈠け璐ャ€俙);
      return;
    }
    let nextState = state;
    for (const result of results) {
      if (!result.ok) continue;
      nextState = await api.saveDraftTemplate(result.template);
    }
    applyState(nextState);
    const first = results.find((result): result is Extract<CozeWorkflowTemplateConversionResult, { ok: true }> => result.ok) ?? null;
    setCozeImportResult(first);
    setCozeImportError('');
    if (first) setEditingId(first.template.id);
  }

  function openEditor(template: DraftTemplate) {
    setDraft(cloneDraftTemplate(template));
    setEditingId(template.id);
  }

  async function selectDraftBackgroundImage() {
    const imagePath = await api.selectLocalImage();
    if (!imagePath) return;
    setDraft((current) => (current ? { ...current, canvas: { ...current.canvas, backgroundImage: imagePath } } : current));
  }

  function updateDraftImage(patch: Partial<DraftTemplate['image']>) {
    setDraft((current) => (current ? { ...current, image: { ...current.image, ...patch } } : current));
  }

  function updateDraftTitle(patch: Partial<DraftTemplate['title']>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, ...patch } } : current));
  }

  function updateDraftSubtitle(patch: Partial<DraftTemplate['subtitle']>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, ...patch } } : current));
  }

  function updateDraftCaption(patch: Partial<DraftTemplate['caption']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, ...patch } } : current));
  }

  function updateDraftCaptionBackground(patch: Partial<DraftTemplate['caption']['background']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, background: { ...current.caption.background, ...patch } } } : current));
  }

  function updateDraftCaptionWidth(value: number) {
    updateDraftCaption({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) });
  }

  function updateDraftDisclaimer(patch: Partial<DraftTemplate['disclaimer']>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, ...patch } } : current));
  }

  function updateDraftTitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, border: { ...current.title.border, ...patch } } } : current));
  }

  function updateDraftSubtitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, border: { ...current.subtitle.border, ...patch } } } : current));
  }

  function updateDraftCaptionBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, border: { ...current.caption.border, ...patch } } } : current));
  }

  function updateDraftDisclaimerBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, border: { ...current.disclaimer.border, ...patch } } } : current));
  }

  if (editingId && draft) {
    return (
      <div className="draft-template-page">
        <div className="editor-topbar">
          <button className="ghost-action" onClick={() => setEditingId(null)}>杩斿洖妯℃澘鍒楄〃</button>
          <input className="template-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : draft)}>鍙栨秷</button>
            <button className="primary-action slim" onClick={save}><Save size={15} />淇濆瓨</button>
          </div>
        </div>

        <div className="draft-editor-shell focused">
          <section className="draft-stage">
            <div className="panel-title-row">
              <div>
                <h2>{draft.name}</h2>
                <span className="hint-text">{draft.canvas.ratio} 路 {draft.canvas.width}x{draft.canvas.height} 路 {draft.image.animation}</span>
              </div>
              <button className="ghost-action" onClick={() => copyTemplate(draft)}><Copy size={15} />澶嶅埗</button>
            </div>
            <EditableDraftCanvas template={draft} selectedLayer={selectedLayer} onSelectLayer={setSelectedLayer} onChange={setDraft} />
          </section>

          <section className="panel draft-controls">
            <Accordion title="鐢诲竷璁剧疆" open>
              <Segmented label="姣斾緥" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft(applyDraftCanvasRatio(draft, value))} />
              <Field label="灏哄"><input value={`${draft.canvas.width}x${draft.canvas.height}`} readOnly /></Field>
              <Field label="搴曡壊">
                <div className="draft-background-field with-swatch">
                  <input className="draft-background-swatch" type="color" value={normalizeColorInput(draft.canvas.backgroundColor)} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                  <input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                </div>
              </Field>
              <Field label="鑳屾櫙鍥?>
                <div className="draft-background-field">
                  <input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} placeholder="鐣欑┖ = 鏃犺儗鏅浘" />
                  <button className="ghost-action" type="button" onClick={selectDraftBackgroundImage}><FolderOpen size={14} />娴忚</button>
                  <button className="ghost-action" type="button" onClick={() => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: '' } })}>娓呯┖</button>
                </div>
              </Field>
            </Accordion>
            <Accordion title="鍥剧墖鍖哄煙" open>
              <ToggleField label="鏄剧ず" checked={draft.image.visible} onChange={(checked) => updateDraftImage({ visible: checked })} />
              <Segmented label="鍥剧墖姣斾緥" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft(applyDraftImageRatio(draft, value))} />
              <Segmented label="閫傞厤" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => updateDraftImage({ fit: value as 'cover' | 'contain' })} />
              <Field label="鍧愭爣"><input value={`top ${draft.image.top.toFixed(2)}, height ${draft.image.height.toFixed(2)}`} readOnly /></Field>
              <RangeField label="鍨傜洿浣嶇疆" min={-1} max={1} step={0.01} value={draft.image.top} onChange={(value) => updateDraftImage({ top: value })} />
              <RangeField label="楂樺害鍗犳瘮" min={0.1} max={1} step={0.01} value={draft.image.height} onChange={(value) => updateDraftImage({ height: value })} />
              <Segmented label="鍔ㄧ敾鏁堟灉" value={draft.image.animation} options={imageAnimations} onChange={(value) => updateDraftImage({ animation: value })} />
            </Accordion>
            <Accordion title="涓绘爣棰?>
              <ToggleField label="鏄剧ず" checked={draft.title.visible} onChange={(checked) => updateDraftTitle({ visible: checked })} />
              <Field label="鏂囧瓧"><input value={draft.title.text} onChange={(event) => updateDraftTitle({ text: event.target.value })} /></Field>
              <Field label="鍧愭爣"><input value={`${draft.title.x.toFixed(2)}, ${draft.title.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="鏂囨湰妗嗗搴? min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="瀛楀彿" min={12} max={120} step={1} value={draft.title.fontSize} onChange={(value) => updateDraftTitle({ fontSize: value })} />
              <ColorField label="棰滆壊" value={draft.title.color} onChange={(value) => updateDraftTitle({ color: value })} />
              <RangeField label="閫忔槑搴? min={0} max={1} step={0.05} value={draft.title.alpha} onChange={(value) => updateDraftTitle({ alpha: value })} />
              <ToggleField label="鍔犵矖" checked={draft.title.bold} onChange={(checked) => updateDraftTitle({ bold: checked })} />
              <ToggleField label="涓嬪垝绾? checked={draft.title.underline} onChange={(checked) => updateDraftTitle({ underline: checked })} />
              <Field label="瀵归綈">
                <select value={String(draft.title.align)} onChange={(event) => updateDraftTitle({ align: Number(event.target.value) })}>
                  <option value="0">宸﹀榻?/option>
                  <option value="1">灞呬腑</option>
                  <option value="2">鍙冲榻?/option>
                </select>
              </Field>
              <RangeField label="瀛楅棿璺? min={0} max={20} step={1} value={draft.title.letterSpacing} onChange={(value) => updateDraftTitle({ letterSpacing: value })} />
              <RangeField label="琛岄棿璺? min={0} max={20} step={1} value={draft.title.lineSpacing} onChange={(value) => updateDraftTitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.title.border} onChange={updateDraftTitleBorder} />
            </Accordion>
            <Accordion title="鍓爣棰?>
              <ToggleField label="鏄剧ず" checked={draft.subtitle.visible} onChange={(checked) => updateDraftSubtitle({ visible: checked })} />
              <Field label="鏂囧瓧"><input value={draft.subtitle.text} onChange={(event) => updateDraftSubtitle({ text: event.target.value })} /></Field>
              <Field label="鍧愭爣"><input value={`${draft.subtitle.x.toFixed(2)}, ${draft.subtitle.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="鏂囨湰妗嗗搴? min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="瀛楀彿" min={10} max={72} step={1} value={draft.subtitle.fontSize} onChange={(value) => updateDraftSubtitle({ fontSize: value })} />
              <ColorField label="棰滆壊" value={draft.subtitle.color} onChange={(value) => updateDraftSubtitle({ color: value })} />
              <RangeField label="閫忔槑搴? min={0} max={1} step={0.05} value={draft.subtitle.alpha} onChange={(value) => updateDraftSubtitle({ alpha: value })} />
              <ToggleField label="鍔犵矖" checked={draft.subtitle.bold} onChange={(checked) => updateDraftSubtitle({ bold: checked })} />
              <ToggleField label="涓嬪垝绾? checked={draft.subtitle.underline} onChange={(checked) => updateDraftSubtitle({ underline: checked })} />
              <Field label="瀵归綈">
                <select value={String(draft.subtitle.align)} onChange={(event) => updateDraftSubtitle({ align: Number(event.target.value) })}>
                  <option value="0">宸﹀榻?/option>
                  <option value="1">灞呬腑</option>
                  <option value="2">鍙冲榻?/option>
                </select>
              </Field>
              <RangeField label="瀛楅棿璺? min={0} max={20} step={1} value={draft.subtitle.letterSpacing} onChange={(value) => updateDraftSubtitle({ letterSpacing: value })} />
              <RangeField label="琛岄棿璺? min={0} max={20} step={1} value={draft.subtitle.lineSpacing} onChange={(value) => updateDraftSubtitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.subtitle.border} onChange={updateDraftSubtitleBorder} />
            </Accordion>
            <Accordion title="瀛楀箷">
              <ToggleField label="鏄剧ず" checked={draft.caption.visible} onChange={(checked) => updateDraftCaption({ visible: checked })} />
              <Field label="鍧愭爣"><input value={`${draft.caption.x.toFixed(2)}, ${draft.caption.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="鏂囨湰妗嗗搴? min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.caption.width} onChange={updateDraftCaptionWidth} />
              <RangeField label="瀛楀彿" min={8} max={48} step={1} value={draft.caption.fontSize} onChange={(value) => updateDraftCaption({ fontSize: value })} />
              <ColorField label="棰滆壊" value={draft.caption.color} onChange={(value) => updateDraftCaption({ color: value })} />
              <RangeField label="閫忔槑搴? min={0} max={1} step={0.05} value={draft.caption.alpha} onChange={(value) => updateDraftCaption({ alpha: value })} />
              <ToggleField label="鍔犵矖" checked={draft.caption.bold} onChange={(checked) => updateDraftCaption({ bold: checked })} />
              <ToggleField label="涓嬪垝绾? checked={draft.caption.underline} onChange={(checked) => updateDraftCaption({ underline: checked })} />
              <Field label="瀵归綈">
                <select value={String(draft.caption.align)} onChange={(event) => updateDraftCaption({ align: Number(event.target.value) })}>
                  <option value="0">宸﹀榻?/option>
                  <option value="1">灞呬腑</option>
                  <option value="2">鍙冲榻?/option>
                </select>
              </Field>
              <RangeField label="瀛楅棿璺? min={0} max={20} step={1} value={draft.caption.letterSpacing} onChange={(value) => updateDraftCaption({ letterSpacing: value })} />
              <RangeField label="琛岄棿璺? min={0} max={20} step={1} value={draft.caption.lineSpacing} onChange={(value) => updateDraftCaption({ lineSpacing: value })} />
              <RangeField label="姣忚瀛楁暟" min={4} max={80} step={1} value={draft.caption.maxCharsPerLine} onChange={(value) => updateDraftCaption({ maxCharsPerLine: value })} />
              <ColorField label="鑳屾櫙鑹? value={draft.caption.background.color} onChange={(value) => updateDraftCaptionBackground({ color: value })} />
              <RangeField label="鑳屾櫙閫忔槑搴? min={0} max={1} step={0.05} value={draft.caption.background.alpha} onChange={(value) => updateDraftCaptionBackground({ alpha: value })} />
              <RangeField label="鍦嗚" min={0} max={1} step={0.05} value={draft.caption.background.roundRadius} onChange={(value) => updateDraftCaptionBackground({ roundRadius: value })} />
              <TextBorderControls border={draft.caption.border} onChange={updateDraftCaptionBorder} />
            </Accordion>
            <Accordion title="鍏嶈矗澹版槑">
              <ToggleField label="鏄剧ず" checked={draft.disclaimer.visible} onChange={(checked) => updateDraftDisclaimer({ visible: checked })} />
              <Field label="鍧愭爣"><input value={`${draft.disclaimer.x.toFixed(2)}, ${draft.disclaimer.y.toFixed(2)}`} readOnly /></Field>
              <Field label="鏂囧瓧"><input value={draft.disclaimer.text} onChange={(event) => updateDraftDisclaimer({ text: event.target.value })} /></Field>
              <RangeField label="鏂囨湰妗嗗搴? min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="瀛楀彿" min={8} max={40} step={1} value={draft.disclaimer.fontSize} onChange={(value) => updateDraftDisclaimer({ fontSize: value })} />
              <ColorField label="棰滆壊" value={draft.disclaimer.color} onChange={(value) => updateDraftDisclaimer({ color: value })} />
              <RangeField label="閫忔槑搴? min={0} max={1} step={0.05} value={draft.disclaimer.alpha} onChange={(value) => updateDraftDisclaimer({ alpha: value })} />
              <ToggleField label="鍔犵矖" checked={draft.disclaimer.bold} onChange={(checked) => updateDraftDisclaimer({ bold: checked })} />
              <ToggleField label="涓嬪垝绾? checked={draft.disclaimer.underline} onChange={(checked) => updateDraftDisclaimer({ underline: checked })} />
              <Field label="瀵归綈">
                <select value={String(draft.disclaimer.align)} onChange={(event) => updateDraftDisclaimer({ align: Number(event.target.value) })}>
                  <option value="0">宸﹀榻?/option>
                  <option value="1">灞呬腑</option>
                  <option value="2">鍙冲榻?/option>
                </select>
              </Field>
              <RangeField label="瀛楅棿璺? min={0} max={20} step={1} value={draft.disclaimer.letterSpacing} onChange={(value) => updateDraftDisclaimer({ letterSpacing: value })} />
              <RangeField label="琛岄棿璺? min={0} max={20} step={1} value={draft.disclaimer.lineSpacing} onChange={(value) => updateDraftDisclaimer({ lineSpacing: value })} />
              <TextBorderControls border={draft.disclaimer.border} onChange={updateDraftDisclaimerBorder} />
            </Accordion>
            <Accordion title="闊抽璁剧疆">
              <Field label="鏃佺櫧闊抽噺"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 闊抽噺"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
              <Field label="杞満">
                <select value={draft.audio.transitionType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionType: event.target.value } })}>
                  <option value="">鍏抽棴</option>
                  {effectCatalog.transitions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="杞満鏃堕暱(ms)"><input type="number" value={draft.audio.transitionDurationMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionDurationMs: Number(event.target.value) } })} /></Field>
              <Field label="鏃佺櫧娣″叆(ms)"><input type="number" value={draft.audio.narrationFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="鏃佺櫧娣″嚭(ms)"><input type="number" value={draft.audio.narrationFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 娣″叆(ms)"><input type="number" value={draft.audio.bgmFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 娣″嚭(ms)"><input type="number" value={draft.audio.bgmFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="婊ら暅">
                <select value={draft.audio.filterType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, filterType: event.target.value } })}>
                  <option value="">鍏抽棴</option>
                  {effectCatalog.filters.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="瑙嗛鐗规晥">
                <select value={draft.audio.videoEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, videoEffectType: event.target.value } })}>
                  <option value="">鍏抽棴</option>
                  {effectCatalog.videoEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="闊抽鐗规晥">
                <select value={draft.audio.audioEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, audioEffectType: event.target.value } })}>
                  <option value="">鍏抽棴</option>
                  {effectCatalog.audioEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
            </Accordion>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-template-page">
      <div className="panel-title-row draft-template-toolbar">
        <div>
          <h2>鑽夌妯℃澘</h2>
          <span className="hint-text">鍐呯疆妯℃澘锛氶粯璁ょ珫灞忋€佺珫灞?:3銆佹í灞?6:9锛涜嚜瀹氫箟妯℃澘淇濆瓨鍦ㄦ湰鏈恒€?/span>
        </div>
        <div className="button-row">
          <button className="ghost-action" type="button" onClick={() => setCozeImportOpen(true)}><Upload size={15} />瀵煎叆 Coze 妯℃澘</button>
          <button className="primary-action slim" onClick={createTemplate}><Plus size={15} />鏂版ā鏉?/button>
        </div>
      </div>

      {cozeImportOpen ? (
        <div className="coze-template-import-backdrop" onClick={() => setCozeImportOpen(false)}>
          <section className="panel coze-template-import-panel coze-template-import-dialog" role="dialog" aria-modal="true" aria-label="瀵煎叆 Coze 妯℃澘" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title-row">
              <div>
                <h3>瀵煎叆 Coze 妯℃澘</h3>
                <span className="hint-text">绮樿创姣忎釜瑙嗛涓嬪鍒跺嚭鐨?Coze 宸ヤ綔娴佹簮鐮侊紝杞崲鎴愬彲缂栬緫鐨勮崏绋挎ā鏉块璁俱€?/span>
              </div>
              <div className="button-row">
                <button className="ghost-action" type="button" onClick={previewCozeWorkflowTemplate}>棰勮杞崲</button>
                <button className="primary-action slim" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveCozeWorkflowTemplate}><Upload size={15} />瀵煎叆 Coze 妯℃澘</button>
                <button className="ghost-action" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveAllCozeWorkflowTemplates}>鍏ㄩ儴瀵煎叆</button>
                <button className="mini-button" type="button" onClick={() => setCozeImportOpen(false)}>鍏抽棴</button>
              </div>
            </div>
            <div className="coze-template-import-grid">
              <Field label="妯℃澘鍚嶇О">
                <input value={cozeImportName} onChange={(event) => setCozeImportName(event.target.value)} placeholder="鐣欑┖鍒欎娇鐢?Coze workflowId" />
              </Field>
              <Field label="Coze 宸ヤ綔娴佹簮鐮?>
                <textarea className="small-textarea coze-workflow-source" value={cozeWorkflowSource} onChange={(event) => setCozeWorkflowSource(event.target.value)} placeholder='绮樿创 {"type":"coze-workflow-clipboard-data", ...}' />
              </Field>
            </div>
            {cozeImportError ? <p className="form-error">{cozeImportError}</p> : null}
            {cozeImportResults.length > 1 ? <span className="hint-text">宸茶瘑鍒?{cozeImportResults.length} 涓?Coze 宸ヤ綔娴佹簮鐮併€?/span> : null}
            {cozeImportResult ? (
              <div className="coze-import-preview">
                <strong>{cozeImportResult.template.name}</strong>
                <span>{cozeImportResult.workflowId} 路 {cozeImportResult.template.canvas.ratio} 路 {cozeImportResult.template.canvas.width}x{cozeImportResult.template.canvas.height}</span>
                <div>
                  <small>杞崲璇婃柇</small>
                  <ul className="coze-diagnostics-list">
                    {cozeImportResult.diagnostics.slice(0, 8).map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${diagnostic.nodeId ?? index}`}>
                        <span>{diagnostic.level}</span>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="draft-template-gallery">
        {state.draftTemplates.map((template) => (
          <article key={template.id} className="draft-template-card">
            <button className="draft-template-thumb" onClick={() => openEditor(template)} type="button" aria-label={`缂栬緫 ${template.name}`}>
              <DraftTemplatePreview template={template} compact />
            </button>
            <div className="draft-template-meta">
              <div>
                <strong>{template.name}</strong>
                {template.isDefault ? <small>绯荤粺榛樿</small> : <small>鏈湴鑷畾涔?/small>}
              </div>
              <span>{template.canvas.ratio} 路 {template.canvas.width}x{template.canvas.height}</span>
              <span>鍥剧墖 {template.image.ratio} 路 {template.image.fit} 路 {template.image.animation}</span>
            </div>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => openEditor(template)}><LayoutTemplate size={15} />缂栬緫</button>
              <button className="ghost-action" onClick={() => copyTemplate(template)}><Copy size={15} />澶嶅埗</button>
            </div>
          </article>
        ))}
        <button className="draft-template-card new-template-card" onClick={createTemplate} type="button">
          <Plus size={24} />
          <strong>鏂版ā鏉?/strong>
          <span>浠庨粯璁ょ珫灞忓鍒朵竴浠芥湰鍦伴厤缃?/span>
        </button>
      </section>
    </div>
  );
}
function DraftTemplatePreview({ template, compact = false }: { template: DraftTemplate; compact?: boolean }) {
  const titleSize = compact ? Math.max(9, template.title.fontSize * 0.28) : template.title.fontSize;
  const subtitleSize = compact ? Math.max(7, template.subtitle.fontSize * 0.28) : template.subtitle.fontSize;
  const captionSize = compact ? Math.max(7, template.caption.fontSize * 0.42) : template.caption.fontSize;
  const disclaimerSize = compact ? Math.max(6, template.disclaimer.fontSize * 0.42) : template.disclaimer.fontSize;
  return (
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} style={draftTemplateCanvasStyle(template)}>
      {template.image.visible ? (
        <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}>
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasText
          className="draft-title"
          x={template.title.x}
          y={template.title.y}
          width={template.title.width}
          border={template.title.border}
          style={draftTextLayerStyle(template.title, titleSize, template.title.bold ? 800 : 500)}
        >
          {template.title.text}
        </DraftCanvasText>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasText
          className="draft-subtitle"
          x={template.subtitle.x}
          y={template.subtitle.y}
          width={template.subtitle.width}
          border={template.subtitle.border}
          style={draftTextLayerStyle(template.subtitle, subtitleSize, template.subtitle.bold ? 800 : 500)}
        >
          {template.subtitle.text}
        </DraftCanvasText>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasText
          className="draft-caption"
          x={template.caption.x}
          y={template.caption.y}
          width={template.caption.width}
          border={template.caption.border}
          style={{
            color: template.caption.color,
            fontSize: captionSize,
            opacity: template.caption.alpha,
            fontWeight: template.caption.bold ? 700 : 500,
            textDecoration: template.caption.underline ? 'underline' : 'none',
            textAlign: draftTextAlign(template.caption.align),
            letterSpacing: `${template.caption.letterSpacing}px`,
            lineHeight: `${1 + template.caption.lineSpacing / 10}`,
            backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
            borderRadius: `${template.caption.background.roundRadius * 24}px`,
            padding: compact ? '2px 8px' : '4px 10px',
          }}
        >
          瀛楀箷棰勮
        </DraftCanvasText>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasText
          className="draft-disclaimer"
          x={template.disclaimer.x}
          y={template.disclaimer.y}
          width={template.disclaimer.width}
          border={template.disclaimer.border}
          style={draftTextLayerStyle(template.disclaimer, disclaimerSize, template.disclaimer.bold ? 700 : 500)}
        >
          {template.disclaimer.text}
        </DraftCanvasText>
      ) : null}
    </div>
  );
}

function EditableDraftCanvas({
  template,
  selectedLayer,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasLayer;
  onSelectLayer: (layer: DraftCanvasLayer) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);

  function handleDraftCanvasPointerDown(layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'move',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    } as DraftDragSnapshot;
  }

  function handleDraftCanvasResizePointerDown(layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'resize',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 2;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 2;
    onChange(drag.mode === 'resize' ? resizeDraftLayerWidth(drag.template, drag.layer, deltaX) : updateDraftLayerPosition(drag.template, drag.layer, deltaX, deltaY));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={canvasRef}
      className="editable-draft-canvas draft-preview-large"
      style={draftTemplateCanvasStyle(template)}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      {template.image.visible ? (
        <div
          className={selectedLayer === 'image' ? 'draft-layer image-layer selected' : 'draft-layer image-layer'}
          data-layer="image"
          style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}
          onPointerDown={(event) => handleDraftCanvasPointerDown('image', event)}
        >
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
          <span>鍥剧墖鍖哄煙</span>
          <i className="draft-layer-handle" />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="涓绘爣棰? selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} width={template.title.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-title"
            x={0}
            y={0}
            width={1}
            border={template.title.border}
            positioned={false}
            style={draftTextLayerStyle(template.title, template.title.fontSize, template.title.bold ? 800 : 500)}
          >
            {template.title.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasLayerBox layer="subtitle" label="鍓爣棰? selected={selectedLayer === 'subtitle'} x={template.subtitle.x} y={template.subtitle.y} width={template.subtitle.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-subtitle"
            x={0}
            y={0}
            width={1}
            border={template.subtitle.border}
            positioned={false}
            style={draftTextLayerStyle(template.subtitle, template.subtitle.fontSize, template.subtitle.bold ? 800 : 500)}
          >
            {template.subtitle.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasLayerBox layer="caption" label="瀛楀箷" selected={selectedLayer === 'caption'} x={template.caption.x} y={template.caption.y} width={template.caption.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-caption"
            x={0}
            y={0}
            width={1}
            border={template.caption.border}
            positioned={false}
            style={{
              color: template.caption.color,
              fontSize: template.caption.fontSize,
              opacity: template.caption.alpha,
              fontWeight: template.caption.bold ? 700 : 500,
              textDecoration: template.caption.underline ? 'underline' : 'none',
              textAlign: draftTextAlign(template.caption.align),
              letterSpacing: `${template.caption.letterSpacing}px`,
              lineHeight: `${1 + template.caption.lineSpacing / 10}`,
              backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
              borderRadius: `${template.caption.background.roundRadius * 24}px`,
              padding: '4px 10px',
            }}
          >
            瀛楀箷棰勮
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasLayerBox layer="disclaimer" label="鍏嶈矗澹版槑" selected={selectedLayer === 'disclaimer'} x={template.disclaimer.x} y={template.disclaimer.y} width={template.disclaimer.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-disclaimer"
            x={0}
            y={0}
            width={1}
            border={template.disclaimer.border}
            positioned={false}
            style={draftTextLayerStyle(template.disclaimer, template.disclaimer.fontSize, template.disclaimer.bold ? 700 : 500)}
          >
            {template.disclaimer.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
    </div>
  );
}

function DraftCanvasLayerBox({
  layer,
  label,
  selected,
  x,
  y,
  width,
  onPointerDown,
  onResizePointerDown,
  children,
}: {
  layer: Exclude<DraftCanvasLayer, 'image'>;
  label: string;
  selected: boolean;
  x: number;
  y: number;
  width: number;
  onPointerDown: (layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={selected ? 'draft-layer text-layer selected' : 'draft-layer text-layer'}
      data-layer={layer}
      style={{ ...draftLayerPositionStyle(x, y), ...draftTextWidthStyle(width) }}
      onPointerDown={(event) => onPointerDown(layer, event)}
    >
      <span>{label}</span>
      {children}
      <i className="draft-layer-handle" onPointerDown={(event) => onResizePointerDown(layer, event)} />
    </div>
  );
}

function SettingsPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [section, setSection] = useState('llm');
  const [draft, setDraft] = useState<AppConfig>(() => normalizeEditableConfigProviders(state.config));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [lastAppliedConfigSignature, setLastAppliedConfigSignature] = useState(() => settingsConfigSignature(state.config));
  const [diagnostics, setDiagnostics] = useState('');
  const [configTestResult, setConfigTestResult] = useState('');
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
  useEffect(() => {
    if (settingsDirty) return;
    const nextSignature = settingsConfigSignature(state.config);
    if (nextSignature === lastAppliedConfigSignature) return;
    setDraft(normalizeEditableConfigProviders(state.config));
    setLastAppliedConfigSignature(nextSignature);
  }, [lastAppliedConfigSignature, settingsDirty, state.config]);
  function setSettingsDraft(next: AppConfig | ((current: AppConfig) => AppConfig)) {
    setSettingsDirty(true);
    setDraft(next);
  }
  function commitSettingsDraft(next: AppConfig) {
    const normalized = normalizeEditableConfigProviders(next);
    setDraft(normalized);
    setSettingsDirty(false);
    setLastAppliedConfigSignature(settingsConfigSignature(normalized));
  }
  async function commitAndApplySettingsDraft(nextDraft: AppConfig, successMessage = '閰嶇疆宸蹭繚瀛?) {
    setSavingConfig(true);
    try {
      const next = await api.saveConfig(normalizeEditableConfigProviders(nextDraft));
      commitSettingsDraft(next.config);
      applyState(next);
      setConfigTestResult(`[pass] ${successMessage}`);
      return next.config;
    } catch (error) {
      setConfigTestResult(`[fail] ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      setSavingConfig(false);
    }
  }
  function clearProviderModels(key: ModelListKey) {
    setModelLists((current) => ({ ...current, [key]: [] }));
    setModelListStatus((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  async function save() {
    await commitAndApplySettingsDraft(activateSelectedProviderProfileForTarget(draft, section as ConfigTestTarget, {
      llm: selectedLlmProfileId,
      image: selectedImageProfileId,
      tts: selectedTtsProfileId,
    }));
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '宸插惎鐢?LLM 閰嶇疆妗ｆ');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '宸插惎鐢ㄧ粯鍥鹃厤缃。妗?);
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '宸插惎鐢?TTS 閰嶇疆妗ｆ');
  }
  async function testCurrentConfig() {
    const target: ConfigTestTarget =
      section === 'llm' || section === 'image' || section === 'tts' || section === 'speechToText' || section === 'jianying' || section === 'creative'
        ? section
        : 'llm';
    setTestingConfig(true);
    setSavingConfig(true);
    setConfigTestResult('姝ｅ湪淇濆瓨骞舵祴璇曞綋鍓嶉厤缃?..');
    try {
      const nextDraft = activateSelectedProviderProfileForTarget(draft, target, {
        llm: selectedLlmProfileId,
        image: selectedImageProfileId,
        tts: selectedTtsProfileId,
      });
      const next = await api.saveConfig(normalizeEditableConfigProviders(nextDraft));
      commitSettingsDraft(next.config);
      applyState(next);
      const testConfig = buildConfigForSelectedProfileTest(next.config, target, selectedProviderProfileIds);
      const result = await api.testAppConfig(target, testConfig);
      setConfigTestResult(`[${result.status}] ${result.detail}`);
    } catch (error) {
      setConfigTestResult(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingConfig(false);
      setTestingConfig(false);
    }
  }
  async function refreshProviderModels(
    key: ModelListKey,
    request: { baseUrl: string; apiKey: string },
    currentModel: string,
    applyModel?: (config: AppConfig, model: string) => AppConfig,
  ) {
    if (key === 'custom-image' && !request.baseUrl.trim()) {
      setModelListStatus((current) => ({ ...current, [key]: '[澶辫触] 鎷夊彇妯″瀷鍓嶉渶瑕佸～鍐欐帴鍙ｅ湴鍧€銆? }));
      return;
    }
    setLoadingModelList(key);
    setModelListStatus((current) => ({ ...current, [key]: '姝ｅ湪鑾峰彇妯″瀷娓呭崟...' }));
    try {
      const result = await api.listProviderModels(request);
      setModelListStatus((current) => ({ ...current, [key]: `[${result.status}] ${result.detail}` }));
      if (result.models.length) {
        setModelLists((current) => ({ ...current, [key]: result.models }));
        if (!currentModel.trim()) {
          setSettingsDraft((current) => (applyModel ? applyModel(current, result.models[0].id) : setDraftModel(current, key, result.models[0].id)));
        }
      }
    } catch (error) {
      setModelListStatus((current) => ({ ...current, [key]: `[fail] ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setLoadingModelList((current) => (current === key ? null : current));
    }
  }
  async function refreshVolcengineSpeakers(profile: TtsProviderProfile) {
    const volcengine = ttsProfileVolcengine(profile);
    const accessKeyId = (volcengine.accessKeyId ?? '').trim();
    const secretAccessKey = (volcengine.secretAccessKey ?? '').trim();
    if (!accessKeyId || !secretAccessKey) {
      setVolcengineSpeakerStatus('[澶辫触] 鍔犺浇鐏北闊宠壊鍒楄〃闇€瑕佸～鍐欒闂瘑閽?ID 鍜岃闂瘑閽?Secret銆?);
      return;
    }

    const resourceId = (volcengine.resourceId ?? '').trim() || 'seed-tts-2.0';
    const limit = 100;
    setLoadingVolcengineSpeakers(true);
    setVolcengineSpeakerStatus('姝ｅ湪鍔犺浇鍏ㄩ儴闊宠壊...');
    try {
      const first = await api.listVolcengineSpeakers({ accessKeyId, secretAccessKey, resourceId, page: 1, limit });
      let speakers = mergeVolcengineSpeakers([], first.speakers);
      const total = first.total || speakers.length;
      if (first.status !== 'fail' && total > speakers.length) {
        const pageCount = Math.min(Math.ceil(total / limit), 20);
        for (let page = 2; page <= pageCount; page += 1) {
          const next = await api.listVolcengineSpeakers({ accessKeyId, secretAccessKey, resourceId, page, limit });
          if (next.status === 'fail' || !next.speakers.length) break;
          speakers = mergeVolcengineSpeakers(speakers, next.speakers);
          if (speakers.length >= total) break;
        }
      }
      setVolcengineSpeakers(speakers);
      const loadedText = speakers.length > first.speakers.length ? `锛屽凡鍚堝苟 ${speakers.length}/${total} 涓猔 : '';
      setVolcengineSpeakerStatus(`[${first.status}] ${first.detail}${loadedText}`);
    } catch (error) {
      setVolcengineSpeakerStatus(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingVolcengineSpeakers(false);
    }
  }
  async function runDiagnostics() {
    const report = await api.runDiagnostics();
    setDiagnostics(JSON.stringify(report, null, 2));
  }
  async function uploadBgmFromSettings() {
    const audioPath = await api.selectLocalAudio();
    if (!audioPath) return;
    const nextBgm = addUploadedBgm(draft, audioPath);
    await commitAndApplySettingsDraft(nextBgm.config, '宸叉坊鍔?BGM 鏂囦欢');
  }
  async function autoDetectJianyingDraftPath() {
    setConfigTestResult('姝ｅ湪鑷姩妫€娴嬪壀鏄犺崏绋跨洰褰?..');
    try {
      const detected = await api.detectJianyingDraftPath();
      if (!detected) {
        setConfigTestResult('[warn] 鏈嚜鍔ㄦ娴嬪埌鍓槧鑽夌鐩綍锛岃鐢ㄢ€滈€夋嫨鐩綍鈥濇墜鍔ㄦ寚瀹氥€?);
        return;
      }
      setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: detected } });
      setConfigTestResult(`[pass] 宸叉娴嬪埌鍓槧鑽夌鐩綍锛?{detected}`);
    } catch (error) {
      setConfigTestResult(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function pickJianyingDraftPath() {
    const folder = await api.selectLocalFolder();
    if (!folder) return;
    setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: folder } });
    setConfigTestResult(`宸查€夋嫨鍓槧鑽夌鐩綍锛?{folder}`);
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
  const selectedProviderProfileIds = {
    llm: selectedLlmProfileId,
    image: selectedImageProfileId,
    tts: selectedTtsProfileId,
  };
  const selectedLlmTestConfig = buildConfigForSelectedProfileTest(draft, 'llm', selectedProviderProfileIds);
  const selectedImageTestConfig = buildConfigForSelectedProfileTest(draft, 'image', selectedProviderProfileIds);
  const selectedTtsTestConfig = buildConfigForSelectedProfileTest(draft, 'tts', selectedProviderProfileIds);
  const settingsBgms = validBgmItems(draft);
  const isSiliconFlowSpeechToText = draft.speechToText.provider === 'siliconflow';
  const sections = [
    ['llm', Sparkles, 'LLM', '鏂囨涓庡垎闀?, settingsStatusLabel(configTargetStatus('llm', draft))],
    ['image', ImageIcon, 'AI 缁樺浘', '鍒嗛暅鍥剧墖', settingsStatusLabel(configTargetStatus('image', draft))],
    ['tts', Bot, 'TTS 閰嶉煶', '姣忛暅璇煶', settingsStatusLabel(configTargetStatus('tts', draft))],
    ['speechToText', Mic2, '璇煶杞枃瀛?, '鐖嗘鎷嗚В杞啓 API', settingsStatusLabel(configTargetStatus('speechToText', draft))],
    ['jianying', FolderOpen, '鍓槧', '鑽夌鐩綍 路 BGM', settingsStatusLabel(configTargetStatus('jianying', draft))],
    ['activation', KeyRound, '婵€娲讳笌璁㈤槄', '璇曠敤 路 婵€娲荤爜', state.activation.status],
    ['creative', Wand2, 'AI 鍒涗綔', 'IMA 鐭ヨ瘑搴?, settingsStatusLabel(configTargetStatus('creative', draft))],
    ['about', Info, '鍏充簬 路 璇婃柇', '鏃ュ織 路 閲嶇疆', '宸查厤缃?],
  ] as const;
  return (
    <div className="settings-layout">
      <section className="settings-menu">
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
            <div><h2>{sections.find(([id]) => id === section)?.[2]}</h2><span>閰嶇疆 API 鍑瘉涓庢湰鍦拌矾寰?/span></div>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={testingConfig || savingConfig} onClick={testCurrentConfig}>
              {testingConfig ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              淇濆瓨骞舵祴璇?
            </button>
            <button className="primary-action slim" disabled={savingConfig} onClick={save}>
              {savingConfig ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              淇濆瓨閰嶇疆
            </button>
          </div>
        </div>
        {configTestResult ? <div className="test-result">{configTestResult}</div> : null}
        {section === 'llm' ? (
          <SettingsCard title="LLM 閰嶇疆妗ｆ" status={maskConfigured(selectedLlmTestConfig.llm.apiKey)}>
            <LlmProfileManager
              config={draft}
              selectedProfileId={selectedLlmProfileId}
              models={modelLists.llm}
              loadingModels={loadingModelList === 'llm'}
              modelStatus={modelListStatus.llm}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => clearProviderModels('llm')}
              onRefreshModels={(profile) => refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: profile.apiKey }, profile.model)}
            />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard title="AI 缁樺浘" status={settingsStatusLabel(configTargetStatus('image', selectedImageTestConfig))}>
            <ImageProfileManager
              config={draft}
              selectedProfileId={selectedImageProfileId}
              gptModels={modelLists['gpt-image']}
              customModels={modelLists['custom-image']}
              loadingModelList={loadingModelList}
              modelStatus={modelListStatus}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedImageProfileId}
              onActivate={activateImageProfile}
              onClearModels={clearProviderModels}
              onRefreshModels={refreshProviderModels}
            />
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 閰嶉煶" status={settingsStatusLabel(configTargetStatus('tts', selectedTtsTestConfig))}>
            <TtsProfileManager
              config={draft}
              selectedProfileId={selectedTtsProfileId}
              cloneVoiceCount={state.minimaxCloneVoices.length}
              volcengineSpeakers={volcengineSpeakers}
              loadingVolcengineSpeakers={loadingVolcengineSpeakers}
              volcengineSpeakerStatus={volcengineSpeakerStatus}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedTtsProfileId}
              onActivate={activateTtsProfile}
              onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}
            />
          </SettingsCard>
        ) : null}
        {section === 'speechToText' ? (
          <SettingsCard title="璇煶杞枃瀛? status={settingsStatusLabel(configTargetStatus('speechToText', draft))}>
            <ProviderConfigNote
              title="杞啓 API"
              value="OpenAI 鍏煎 /audio/transcriptions锛汼iliconFlow 浣跨敤 file銆乵odel锛岄粯璁?FunAudioLLM/SenseVoiceSmall锛屼篃鍙€?TeleAI/TeleSpeechASR銆?
            />
            <Segmented
              label="渚涘簲鍟?
              value={draft.speechToText.provider}
              options={['openai-compatible', 'siliconflow']}
              labels={['OpenAI 鍏煎', 'SiliconFlow']}
              onChange={(value) => switchSpeechToTextProvider(value as AppConfig['speechToText']['provider'])}
            />
            <ConfigInput label="鎺ュ彛鍦板潃" value={draft.speechToText.baseUrl} onChange={(value) => updateSpeechToTextConfig({ baseUrl: value })} />
            <ConfigInput label="鎺ュ彛瀵嗛挜" value={draft.speechToText.apiKey} onChange={(value) => updateSpeechToTextConfig({ apiKey: value })} />
            {isSiliconFlowSpeechToText ? (
              <Segmented
                label="杞啓妯″瀷"
                value={draft.speechToText.model}
                options={siliconFlowSpeechToTextModels}
                onChange={(value) => updateSpeechToTextConfig({ model: value })}
              />
            ) : (
              <ConfigInput label="杞啓妯″瀷" value={draft.speechToText.model} onChange={(value) => updateSpeechToTextConfig({ model: value })} />
            )}
            <ConfigInput label="璇█" value={draft.speechToText.language} onChange={(value) => updateSpeechToTextConfig({ language: value })} />
            <ConfigInput label="鎻愮ず璇? value={draft.speechToText.prompt} onChange={(value) => updateSpeechToTextConfig({ prompt: value })} />
            {isSiliconFlowSpeechToText ? (
              <LocalInfo title="SiliconFlow 鍙傛暟" value="鎸夊畼鏂规帴鍙ｅ彧鎻愪氦 file 鍜?model锛屼笂浼犱笂闄?50MB銆俵anguage銆乸rompt銆乼emperature銆佹椂闂存埑鍜屽垏鍒嗙瓥鐣ヤ笉浼氶殢璇锋眰鍙戦€併€? />
            ) : (
              <Segmented
                label="鍝嶅簲鏍煎紡"
                value={draft.speechToText.responseFormat}
                options={['json', 'verbose_json', 'text', 'srt', 'vtt']}
                labels={['JSON', 'Verbose JSON', 'Text', 'SRT', 'VTT']}
                onChange={(value) => updateSpeechToTextConfig({ responseFormat: value as AppConfig['speechToText']['responseFormat'] })}
              />
            )}
            {!isSiliconFlowSpeechToText ? <RangeField label="娓╁害" min={0} max={1} step={0.1} value={draft.speechToText.temperature} onChange={(value) => updateSpeechToTextConfig({ temperature: value })} /> : null}
            <ConfigNumberInput
              label="璇锋眰瓒呮椂锛堢锛?
              value={Math.round(draft.speechToText.timeoutMs / 1000)}
              min={10}
              step={10}
              onChange={(value) => updateSpeechToTextConfig({ timeoutMs: value * 1000 })}
            />
            {!isSiliconFlowSpeechToText ? (
              <Field label="鏃堕棿鎴?>
                <div className="settings-inline-actions">
                  <ToggleField
                    label="娈佃惤绾?
                    checked={draft.speechToText.timestampGranularities.includes('segment')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('segment', checked)}
                  />
                  <ToggleField
                    label="璇嶇骇"
                    checked={draft.speechToText.timestampGranularities.includes('word')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('word', checked)}
                  />
                </div>
              </Field>
            ) : null}
            {!isSiliconFlowSpeechToText ? (
              <Segmented
                label="鍒囧垎绛栫暐"
                value={draft.speechToText.chunkingStrategy}
                options={['none', 'auto']}
                labels={['涓嶅惎鐢?, '鑷姩']}
                onChange={(value) => updateSpeechToTextConfig({ chunkingStrategy: value as AppConfig['speechToText']['chunkingStrategy'] })}
              />
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="鍓槧鑽夌涓?BGM" status={draft.jianying.draftPath ? '宸查厤缃? : '寰呴厤缃?}>
            <ConfigInput label="鑽夌鐩綍" value={draft.jianying.draftPath} onChange={(value) => setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } })} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" onClick={autoDetectJianyingDraftPath}><Search size={15} />鑷姩妫€娴?/button>
              <button className="ghost-action" type="button" onClick={pickJianyingDraftPath}><FolderOpen size={15} />閫夋嫨鐩綍</button>
            </div>
            <LocalInfo title="BGM 搴? value={settingsBgms.length ? settingsBgms.map((bgm) => bgm.title).join('銆?) : 'BGM 搴撲负绌?} />
            <button className="ghost-action" type="button" onClick={uploadBgmFromSettings}><Upload size={15} />+ 娣诲姞 BGM 鏂囦欢</button>
            <div className="bgm-library-list">
              {settingsBgms.length === 0 ? <div className="bgm-library-empty">BGM 搴撲负绌?/div> : null}
              {settingsBgms.map((bgm) => (
                <div key={bgm.id} className="bgm-library-item">
                  <div>
                    <strong>{bgm.title}</strong>
                    <span>{bgm.path}</span>
                  </div>
                  <label>
                    闊抽噺
                    <input type="number" min="0" max="1" step="0.05" value={bgm.volume} onChange={(event) => updateBgmVolume(bgm.id, Number(event.target.value))} />
                  </label>
                  <button className={draft.jianying.defaultBgmId === bgm.id ? 'mini-button active' : 'mini-button'} type="button" onClick={() => setDefaultBgm(bgm.id)}>
                    {draft.jianying.defaultBgmId === bgm.id ? '榛樿' : '璁句负榛樿'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => removeBgm(bgm.id)}>绉婚櫎</button>
                </div>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="婵€娲讳笌璁㈤槄" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 鍒涗綔 / IMA 鐭ヨ瘑搴? status={draft.ima.apiKey ? '宸查厤缃? : '寰呴厤缃?}>
            <ConfigInput label="瀹㈡埛绔?ID" value={draft.ima.clientId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <ConfigInput label="鎺ュ彛瀵嗛挜" value={draft.ima.apiKey} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, apiKey: value } })} />
            <ConfigInput label="鐭ヨ瘑搴撳悕绉? value={draft.ima.kbName} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
            <button className="ghost-action">娴嬭瘯骞舵媺鍙栫煡璇嗗簱</button>
          </SettingsCard>
        ) : null}
        {section === 'about' ? (
          <div className="diagnostics-card">
            <LocalInfo title="瑙嗛鏁呬簨鍒涗綔鍔╂墜" value="v0.10.4 路 beta 路 Windows 路 鏈湴鏁版嵁鐩綍" />
            <div className="button-row">
              <button className="ghost-action" onClick={runDiagnostics}>妫€鏌ヨ瘖鏂?/button>
              <button className="ghost-action" onClick={() => navigator.clipboard?.writeText(diagnostics)}>
                <Copy size={15} />
                澶嶅埗璇婃柇鎶ュ憡
              </button>
              <button className="danger-action"><XCircle size={15} />娓呯悊鍘嗗彶</button>
            </div>
            <pre>{diagnostics || '鐐瑰嚮妫€鏌ヨ瘖鏂悗鏄剧ず LLM銆乀TS銆丅GM銆佸壀鏄犵洰褰曘€佽处鎴风姸鎬佺瓑妫€鏌ョ粨鏋溿€?}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LlmProfileManager({
  config,
  selectedProfileId,
  models,
  loadingModels,
  modelStatus,
  saving,
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

  if (!selectedProfile) return <ArtifactEmpty text="鏆傛棤 LLM 閰嶇疆妗ｆ" />;

  const selectedProvider = editableLlmProfileProvider(selectedProfile);
  const requestParamsJsonValue = selectedProfile.requestParamsJson ?? '{}';
  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>閰嶇疆妗ｆ</strong>
          <span>鍙繚瀛樺涓?OpenAI 鍏煎鎺ュ彛锛屽惎鐢ㄤ竴涓綔涓轰换鍔¤繍琛岄厤缃€?/span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          鏂板閰嶇疆
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
              <div className="profile-drag-dot">鈰嫯</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'C'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '鏈懡鍚嶉厤缃?}</strong>
                <span>{profile.baseUrl || 'https://api.openai.com'}</span>
                <small>{profile.model || '鏈€夋嫨妯″瀷'}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">鍚敤涓?/span>
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
                    鍚敤
                  </button>
                )}
                <button className="icon-button" type="button" title="缂栬緫" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="澶嶅埗" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="鍒犻櫎" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="閰嶇疆鍚嶇О" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <ConfigNumberInput
          label="璇锋眰瓒呮椂锛堢锛?
          value={Math.round((selectedProfile.timeoutMs ?? defaultConfig.llm.timeoutMs ?? 120000) / 1000)}
          min={10}
          step={10}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, timeoutMs: value * 1000 })}
        />
        <Segmented
          label="渚涘簲鍟?
          value={selectedProvider}
          options={['openai', 'custom']}
          labels={['OpenAI', '鑷畾涔?]}
          onChange={(value) => {
            onClearModels();
            updateSelectedProfile({
              ...selectedProfile,
              provider: value,
              baseUrl: value === 'openai' ? 'https://api.openai.com' : selectedProfile.baseUrl === 'https://api.openai.com' ? defaultConfig.llm.baseUrl : selectedProfile.baseUrl,
            });
          }}
        />
        {selectedProvider === 'openai' ? (
          <>
            <ProviderConfigNote title="OpenAI 瀵硅瘽鎺ュ彛" value="浣跨敤瀹樻柟 /v1/chat/completions锛屽～鍐欐帴鍙ｅ瘑閽ヤ笌妯″瀷銆? />
            <ConfigInput label="OpenAI 鎺ュ彛瀵嗛挜" value={selectedProfile.apiKey} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, apiKey: value }); }} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="OpenAI 妯″瀷"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="闄勫姞璇锋眰 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        ) : (
          <>
            <ProviderConfigNote title="OpenAI 鍏煎 LLM" value="鑷畾涔夋帴鍙ｆ寜 /chat/completions 璋冪敤锛岄渶瑕佹帴鍙ｅ湴鍧€銆佹帴鍙ｅ瘑閽ヤ笌妯″瀷銆? />
            <ConfigInput label="鎺ュ彛鍦板潃" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, baseUrl: value }); }} />
            <ConfigInput label="鎺ュ彛瀵嗛挜" value={selectedProfile.apiKey} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, apiKey: value }); }} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="妯″瀷"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="闄勫姞璇锋眰 JSON"
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

function ImageProfileManager({
  config,
  selectedProfileId,
  gptModels,
  customModels,
  loadingModelList,
  modelStatus,
  saving,
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
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: (key: ModelListKey) => void;
  onRefreshModels: (key: ModelListKey, request: { baseUrl: string; apiKey: string }, currentModel: string, applyModel?: (config: AppConfig, model: string) => AppConfig) => void;
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
  if (!selectedProfile) return <ArtifactEmpty text="鏆傛棤缁樺浘閰嶇疆妗ｆ" />;

  const provider = selectedProfile.provider;
  const gptImage = imageProfileGptImage(selectedProfile);
  const jimeng = imageProfileJimeng(selectedProfile);
  const customImage = imageProfileCustomImage(selectedProfile);

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
          <strong>缁樺浘妗ｆ</strong>
          <span>鍙繚瀛?GPT Image銆佸嵆姊﹀拰鑷畾涔夊浘鐗囨帴鍙ｏ紝鍚敤涓€涓綔涓轰换鍔＄敓鍥鹃厤缃€?/span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          鏂板閰嶇疆
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
              <div className="profile-drag-dot">鈰嫯</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'I'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '鏈懡鍚嶇粯鍥鹃厤缃?}</strong>
                <span>{imageProviderLabel(profile.provider)}</span>
                <small>{imageProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">鍚敤涓?/span>
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
                    鍚敤
                  </button>
                )}
                <button className="icon-button" type="button" title="缂栬緫" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="澶嶅埗" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="鍒犻櫎" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="閰嶇疆鍚嶇О" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="渚涘簲鍟?
          value={provider}
          options={['gpt_image', 'jimeng', 'custom']}
          labels={['GPT Image', '鍗虫ⅵ', '鑷畾涔?]}
          onChange={(value) => {
            onClearModels('gpt-image');
            onClearModels('custom-image');
            updateSelectedProfile({ ...selectedProfile, provider: value as ImageProviderProfile['provider'] });
          }}
        />
        {provider === 'gpt_image' ? (
          <>
            <ProviderConfigNote title="OpenAI 鍥惧儚鎺ュ彛" value="鎺ュ彛瀵嗛挜涓庢ā鍨嬪繀濉紱鎺ュ彛鍦板潃涓虹┖鏃朵娇鐢ㄥ畼鏂归粯璁ょ鐐广€? />
            <ConfigInput label="GPT Image 鎺ュ彛鍦板潃锛堝彲閫夛級" value={gptImage.baseUrl} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, baseUrl: value } }); }} />
            <ConfigInput label="GPT Image 鎺ュ彛瀵嗛挜" value={gptImage.apiKey} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, apiKey: value } }); }} />
            <ModelPicker
              key={`gpt-image-${selectedProfile.id}`}
              label="GPT Image 妯″瀷"
              value={gptImage.model}
              models={gptModels}
              loading={loadingModelList === 'gpt-image'}
              status={modelStatus['gpt-image']}
              onRefresh={() => onRefreshModels(
                'gpt-image',
                { baseUrl: gptImage.baseUrl || 'https://api.openai.com', apiKey: gptImage.apiKey },
                gptImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, gptImage: { ...gptImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, model: value } })}
            />
            <Segmented label="鍒嗚鲸鐜? value={gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, resolution: value as ImageResolution } })} />
            <Field label="骞跺彂"><input type="range" min="1" max="6" value={gptImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'jimeng' ? (
          <>
            <ProviderConfigNote title="鐏北瑙嗚鎺ュ彛" value={`绔偣 ${jimeng.endpoint || 'https://visual.volcengineapi.com'} 路 鍖哄煙 ${jimeng.region || 'cn-north-1'} 路 鏈嶅姟 ${jimeng.service || 'cv'}`} />
            <ConfigInput label="鍗虫ⅵ璁块棶瀵嗛挜 ID" value={jimeng.accessKeyId ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, accessKeyId: value } })} />
            <ConfigInput label="鍗虫ⅵ璁块棶瀵嗛挜 Secret" value={jimeng.secretAccessKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, secretAccessKey: value } })} />
            <ConfigInput label="鍗虫ⅵ璇锋眰 Key" value={jimeng.reqKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, reqKey: value } })} />
            <Segmented label="鍒嗚鲸鐜? value={jimeng.resolution} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, resolution: value as ImageResolution } })} />
            <Field label="骞跺彂"><input type="range" min="1" max="6" value={jimeng.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'custom' ? (
          <>
            <ProviderConfigNote title="OpenAI 鍏煎鎺ュ彛" value="鑷畾涔夊浘鐗囨帴鍙ｆ寜 /images/generations 璋冪敤锛岄渶瑕佹帴鍙ｅ湴鍧€銆佹帴鍙ｅ瘑閽ヤ笌妯″瀷銆? />
            <ConfigInput label="鑷畾涔夋帴鍙ｅ湴鍧€" value={customImage.baseUrl} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, baseUrl: value } }); }} />
            <ConfigInput label="鑷畾涔夋帴鍙ｅ瘑閽? value={customImage.apiKey} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, apiKey: value } }); }} />
            <ModelPicker
              key={`custom-image-${selectedProfile.id}`}
              label="鑷畾涔夋ā鍨?
              value={customImage.model}
              models={customModels}
              loading={loadingModelList === 'custom-image'}
              status={modelStatus['custom-image']}
              onRefresh={() => onRefreshModels(
                'custom-image',
                { baseUrl: customImage.baseUrl, apiKey: customImage.apiKey },
                customImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, customImage: { ...customImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, model: value } })}
            />
            <Segmented label="鍒嗚鲸鐜? value={customImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, resolution: value as ImageResolution } })} />
            <Field label="骞跺彂"><input type="range" min="1" max="6" value={customImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TtsProfileManager({
  config,
  selectedProfileId,
  cloneVoiceCount,
  volcengineSpeakers,
  loadingVolcengineSpeakers,
  volcengineSpeakerStatus,
  saving,
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
  if (!selectedProfile) return <ArtifactEmpty text="鏆傛棤 TTS 閰嶇疆妗ｆ" />;

  const provider = selectedProfile.provider;
  const volcengine = ttsProfileVolcengine(selectedProfile);
  const minimax = ttsProfileMinimax(selectedProfile);
  const voiceSelection = volcenginePresetVoiceValue(volcengine.speaker, availableVolcengineVoices);

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
          <strong>TTS 妗ｆ</strong>
          <span>鍙繚瀛樼伀灞卞紩鎿庝笌 MiniMax 閰嶉煶閰嶇疆锛屽惎鐢ㄤ竴涓綔涓轰换鍔￠厤闊抽厤缃€?/span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          鏂板閰嶇疆
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
              <div className="profile-drag-dot">鈰嫯</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'T'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '鏈懡鍚?TTS 閰嶇疆'}</strong>
                <span>{ttsProviderLabel(profile.provider)}</span>
                <small>{ttsProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">鍚敤涓?/span>
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
                    鍚敤
                  </button>
                )}
                <button className="icon-button" type="button" title="缂栬緫" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="澶嶅埗" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="鍒犻櫎" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="閰嶇疆鍚嶇О" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="寮曟搸"
          value={provider}
          options={['volcengine', 'minimax']}
          labels={['鐏北寮曟搸', 'MiniMax']}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: value as TtsProviderProfile['provider'] })}
        />
        {provider === 'volcengine' ? (
          <>
            <ProviderConfigNote title="鐏北寮曟搸 TTS" value="V3 HTTP Chunked 浣跨敤鏂扮増鎺у埗鍙?TTS 鎺ュ彛瀵嗛挜锛涜祫婧愪笌绔偣浣跨敤绯荤粺榛樿閰嶇疆銆? />
            <ConfigInput label="鐏北 TTS 鎺ュ彛瀵嗛挜" value={volcengine.apiKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, apiKey: value } })} />
            <Field label="榛樿闊宠壊">
              <div className="model-picker">
                <select value={voiceSelection} onChange={(event) => updateVolcengineVoice(event.target.value === 'custom' ? '' : event.target.value)}>
                  <option value="custom">鑷畾涔?voice_type</option>
                  {availableVolcengineVoices.map((voice) => (
                    <option key={voice.voiceType} value={voice.voiceType}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {voiceSelection === 'custom' ? (
              <ConfigInput label="鑷畾涔?voice_type" value={volcengine.speaker} onChange={updateVolcengineVoice} />
            ) : null}
          </>
        ) : null}
        {provider === 'minimax' ? (
          <>
            <ProviderConfigNote title="MiniMax TTS" value="濉啓鎺ュ彛瀵嗛挜銆佹ā鍨嬪拰闊宠壊 ID銆? />
            <ConfigInput label="MiniMax 鎺ュ彛瀵嗛挜" value={minimax.apiKey} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, apiKey: value } })} />
            <ConfigInput label="MiniMax 妯″瀷" value={minimax.model} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, model: value } })} />
            <ConfigInput label="MiniMax 闊宠壊 ID" value={minimax.voiceId} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, voiceId: value } })} />
            <LocalInfo title="鍏嬮殕闊宠壊" value={`${cloneVoiceCount} 涓湰鍦拌褰曪紝鍙悗缁帴鍏?MiniMax 鍏嬮殕鎺ュ彛銆俙} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [draft, setDraft] = useState(state.account);
  useEffect(() => setDraft(state.account), [state.account]);
  return (
    <section className="panel account-panel">
      <div className="profile-card">
        <div className="avatar">{draft.avatarInitial || 'S'}</div>
        <div>
          <h2>{draft.displayName}</h2>
          <span>{draft.email} 路 {draft.deviceId}</span>
        </div>
        <strong>{draft.balance.toFixed(2)} 绉垎</strong>
      </div>
      <ConfigInput label="鏄剧ず鍚嶇О" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value, avatarInitial: value.slice(0, 1).toUpperCase() || 'S' })} />
      <ConfigInput label="閭" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
      <ConfigInput label="宸ヤ綔鍖? value={draft.workspace} onChange={(value) => setDraft({ ...draft, workspace: value })} />
      <button className="primary-action slim" onClick={async () => applyState(await api.saveAccount(draft))}><Save size={15} />淇濆瓨璧勬枡</button>
      <LocalInfo title="璐﹀彿涓庢縺娲诲叧绯? value="鏈湴澶嶅埢鐗堝彧鏄剧ず璁惧銆佽处鎴峰拰浣欓鐘舵€侊紝涓嶈繛鎺ョ湡瀹炵櫥褰曟垨浠樿垂绯荤粺銆? />
    </section>
  );
}

function ActivationPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: (state: AppState) => void }) {
  const [draft, setDraft] = useState(state.activation);
  useEffect(() => setDraft(state.activation), [state.activation]);
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title-row">
          <h2>婵€娲荤姸鎬?/h2>
          <StatusPill status={draft.status === 'active' ? 'completed' : 'paused'} />
        </div>
        <ConfigInput label="婵€娲荤爜" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
        <Segmented label="璁″垝" value={draft.plan} options={['trial', 'local', 'inactive']} labels={['璇曠敤', '鏈湴婵€娲?, '鏈縺娲?]} onChange={(value) => setDraft({ ...draft, plan: value as ActivationState['plan'] })} />
        <ConfigInput label="鐘舵€佽鏄? value={draft.message} onChange={(value) => setDraft({ ...draft, message: value })} />
        <button className="primary-action slim" onClick={async () => applyState(await api.saveActivation(draft))}><Save size={15} />淇濆瓨鐘舵€?/button>
      </section>
      <section className="panel faq-panel">
        <LocalInfo title="绔嬪嵆婵€娲? value="杩欓噷鏄湰鍦版ā鎷熺姸鎬侀〉锛屼笉鍋氱湡瀹炶喘涔般€佺櫥褰曟垨浠樿垂闄愬埗銆? />
        <LocalInfo title="甯歌闂" value="婵€娲荤爜銆佽闃呫€佽澶囪В缁戝潎涓烘湰鍦?UI 鐘舵€侊紝鍙敤浜庡悗缁帴鍏ョ湡瀹炴湇鍔°€? />
      </section>
    </div>
  );
}

function SettingsCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="config-card">
      <div className="config-card-head"><div><strong>{title}</strong><span>浣跨敤涓?/span></div><small>{status}</small></div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="config-input"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ConfigTextarea({
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

function ConfigNumberInput({
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

function ModelPicker({
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
            {!value ? <option value="">閫夋嫨妯″瀷</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button className="icon-button model-refresh-button" title="鑾峰彇妯″瀷" aria-label="鑾峰彇妯″瀷" disabled={loading} onClick={onRefresh} type="button">
          {loading ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
      {status ? <small className="model-list-status">{status}</small> : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="draft-toggle-row">
      <span>{label}</span>
      <label className="draft-toggle-field draft-toggle-control">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="draft-toggle-box" aria-hidden="true">{checked ? '鉁? : ''}</span>
        <span>{checked ? '寮€鍚? : '鍏抽棴'}</span>
      </label>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="draft-color-field">
        <input type="color" value={normalizeColorInput(value)} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="draft-range-field">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </Field>
  );
}

function TextBorderControls({
  label,
  border,
  onChange,
}: {
  label?: string;
  border: DraftTextBorder;
  onChange: (patch: Partial<DraftTextBorder>) => void;
}) {
  return (
    <div className="draft-border-controls">
      {label ? <span className="field-title">{label}</span> : null}
      <div className="draft-inline-border-grid">
        <ColorField label="鎻忚竟棰滆壊" value={border.color} onChange={(value) => onChange({ color: value })} />
        <RangeField label="鎻忚竟瀹藉害" min={0} max={60} step={1} value={border.width} onChange={(value) => onChange({ width: value })} />
        <RangeField label="鎻忚竟閫忔槑搴? min={0} max={1} step={0.05} value={border.alpha} onChange={(value) => onChange({ alpha: value })} />
      </div>
    </div>
  );
}

function Segmented({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented">
        {options.map((option, index) => (
          <button key={option} className={option === value ? 'selected' : ''} onClick={() => onChange(option)} type="button">
            {labels?.[index] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionCloud({ title, options, value, onChange }: { title: string; options: string[][]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="field-title">{title}</span>
      <div className="option-cloud">
        {options.map(([id, label, hint]) => (
          <button key={id} className={value === id ? 'option-pill active' : 'option-pill'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Accordion({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <div className={expanded ? 'accordion open' : 'accordion'}>
      <button onClick={() => setExpanded(!expanded)}>鈥?{title}</button>
      {expanded ? <div>{children}</div> : null}
    </div>
  );
}

function EventTimeline({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) return <EmptyState title="鏆傛棤浜嬩欢" />;
  return (
    <div className="event-list">
      {events.map((event, index) => (
        <div className="event-item" key={`${event.seq ?? index}-${event.ts}`}>
          <span>{event.step ?? '-'}</span>
          {event.type === 'step_error' ? <ErrorSummaryButton fullMessage={event.detail} title={`姝ラ ${event.step ?? '-'} 閿欒`} compact /> : <p>{event.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabel(status)}</span>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="empty-state"><Database size={20} /><span>{title}</span></div>;
}

function LocalInfo({ title, value }: { title: string; value: string }) {
  return <div className="local-info"><Info size={18} /><div><strong>{title}</strong><span>{value}</span></div></div>;
}

function ErrorSummaryButton({ fullMessage, title, compact = false }: { fullMessage: string; title: string; compact?: boolean }) {
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

function ErrorDetailDialog({ title, summary, fullMessage, onClose }: { title: string; summary: string; fullMessage: string; onClose: () => void }) {
  return (
    <div className="error-dialog-backdrop" onClick={onClose}>
      <section className="error-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="error-dialog-head">
          <div>
            <span className="error-mark">!</span>
            <strong>{title}</strong>
          </div>
          <button className="mini-button" type="button" onClick={onClose}>鍏抽棴</button>
        </div>
        <p>{summary}</p>
        <pre>{fullMessage}</pre>
      </section>
    </div>
  );
}

function ProviderConfigNote({ title, value }: { title: string; value: string }) {
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

function resolvePromptTemplateForTrack(templates: PromptTemplate[], track: string, overrideId?: string | null): PromptTemplate | null {
  return selectTaskPromptTemplate(templates, { track, promptTemplateId: overrideId ?? null });
}

function independentPromptTemplateFields(template: PromptTemplate): PromptTemplate {
  const copy = { ...template };
  delete copy.baseTemplateId;
  return copy;
}

function promptTemplateHasStepPrompt(template: PromptTemplate, type: PromptStepTemplateType): boolean {
  return Object.prototype.hasOwnProperty.call(template.stepPrompts ?? {}, type);
}

function promptTemplateStepPromptValue(template: PromptTemplate, templates: PromptTemplate[], type: PromptStepTemplateType): string {
  if (promptTemplateHasStepPrompt(template, type)) return template.stepPrompts?.[type] ?? '';
  return selectStepPromptTemplate(templates, type)?.content ?? '';
}

function promptTemplateTypeLabel(type: PromptTemplateType | 'all'): string {
  return promptTemplateTypeLabels[type];
}

function promptTemplateStyleOptions(styles: CustomStyle[], template: PromptTemplate): CustomStyle[] {
  const byId = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style]));
  resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).forEach((id) => {
    if (!byId.has(id)) {
      const option = styleOptions.find(([styleId]) => styleId === id);
      if (option) {
        byId.set(id, {
          id,
          name: option[1],
          tag: option[2],
          shortName: option[1],
          prefix: option[1],
          suffix: option[2],
          negativePrompt: '',
          allowColor: id !== 'black-white',
          description: option[2],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
  return [...byId.values()];
}

function promptTemplateStyleLabelList(template: PromptTemplate, styles: CustomStyle[]): string[] {
  const styleNames = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style.name]));
  return resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).map((id) => styleNames.get(id) ?? styleLabel(id, styles));
}

function styleLabel(id: string, styles: CustomStyle[] = defaultCustomStyles): string {
  return [...defaultCustomStyles, ...styles].find((style) => style.id === id)?.name ?? styleOptions.find(([styleId]) => styleId === id)?.[1] ?? id;
}

function smartImageModeLabel(mode: ImageLabSmartMode = 'text-to-image'): string {
  if (mode === 'text-to-image') return '鏂囩敓鍥?;
  return smartImageModeOptions.find(([id]) => id === mode)?.[1] ?? mode;
}

function resolveImageLabSmartMode(tab: 'smart' | 'text' | 'reference', smartMode: ImageLabSmartMode, references: string[]): ImageLabSmartMode {
  return tab === 'smart' && references.length > 0 ? 'reference-edit' : tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
}

function parseReferenceImagePaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftTemplateImageRatio(templates: DraftTemplate[], templateId: string): string {
  return templates.find((template) => template.id === templateId)?.image.ratio ?? templates[0]?.image.ratio ?? '9:16';
}

function defaultTaskDraftTemplateId(templates: DraftTemplate[]): string {
  return templates.find((template) => !isBundledDraftTemplateOption(template))?.id ?? templates[0]?.id ?? 'default-portrait-9-16';
}

function draftTemplateLabel(templateId: string, templates: DraftTemplate[]): string {
  return templates.find((template) => template.id === templateId)?.name ?? templateId;
}

function isBundledDraftTemplateOption(template: Pick<DraftTemplate, 'id' | 'isDefault'>): boolean {
  return !template.isDefault && bundledDraftTemplateOptionIds.has(template.id);
}

function characterPolicyLabel(policy: PromptTemplate['characterPolicy']): string {
  if (policy === 'force-extract') return '寮哄埗鎻愬彇';
  if (policy === 'force-skip') return '寮哄埗璺宠繃';
  return '璺熼殢璧涢亾';
}

function referenceKindLabel(kind: PromptTemplate['referenceKind']): string {
  if (kind === 'face') return '浜鸿劯';
  if (kind === 'product') return '浜у搧';
  return '鏃?;
}

function buildImageStyleDraftFromPrompt(prompt: string, base: CustomStyle): Pick<CustomStyle, 'name' | 'tag' | 'shortName' | 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor' | 'description'> {
  const normalized = prompt.trim() || base.name;
  const tags = splitListInput(normalized).slice(0, 4);
  const name = tags[0] || normalized.slice(0, 12) || base.name;
  return {
    name,
    tag: tags.length ? tags.join('銆?) : base.tag,
    shortName: name.slice(0, 4),
    prefix: [normalized, base.prefix].filter(Boolean).join('锛?),
    suffix: base.suffix || '楂樿川閲忥紝娓呮櫚缁嗚妭锛岀數褰辩骇鏋勫浘',
    negativePrompt: base.negativePrompt || '妯＄硦锛屽櫔鐐癸紝杩囨洕锛屼綆璐ㄩ噺锛屾按鍗帮紝鏂囧瓧',
    allowColor: !/榛戠櫧|鍗曡壊|mono/i.test(normalized) && base.allowColor,
    description: `閫傚悎${normalized}棰樻潗銆俙,
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[,锛屻€乗n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validBgmItems(config: AppConfig): BgmItem[] {
  return config.jianying.bgmLibrary.filter((bgm) => bgm.id.trim() && bgm.path.trim());
}

function resolveDefaultBgmId(config: AppConfig): string {
  const bgms = validBgmItems(config);
  return bgms.some((bgm) => bgm.id === config.jianying.defaultBgmId) ? config.jianying.defaultBgmId : bgms[0]?.id ?? '';
}

function addUploadedBgm(config: AppConfig, audioPath: string): { config: AppConfig; bgmId: string } {
  const id = `bgm-${crypto.randomUUID()}`;
  const item: BgmItem = {
    id,
    title: audioTitleFromPath(audioPath),
    path: audioPath,
    durationMs: 0,
    volume: 0.25,
  };
  const existingDefaultId = resolveDefaultBgmId(config);
  const bgmLibrary = [...validBgmItems(config), item];
  const nextConfig = {
    ...config,
    jianying: {
      ...config.jianying,
      bgmLibrary,
      defaultBgmId: existingDefaultId || id,
    },
  };
  return { config: nextConfig, bgmId: id };
}

function audioTitleFromPath(path: string): string {
  const filename = path.split(/[\\/]/u).pop() || 'BGM';
  return filename.replace(/\.[^.]+$/u, '') || filename;
}

function pageSubtitle(view: ShellView): string {
  const map: Partial<Record<ShellView, string>> = {
    'new-task': '绮樿创涓€娈典汉鐗╂晠浜嬶紝鍑犲垎閽熷悗鍦ㄥ壀鏄犻噷鎵撳紑',
    queue: '鏌ョ湅褰撳墠浠诲姟銆佹楠や簨浠躲€佸け璐ラ噸璇曞拰杈撳嚭鐘舵€?,
    history: '鎸夋椂闂存祻瑙堝凡瀹屾垚銆佸け璐ャ€佸彇娑堝拰鑽夌浠诲姟',
    'task-detail': '鏌ョ湅鍗曚釜浠诲姟鐨勭嫭绔嬫墽琛岀姸鎬佸拰娴佹按绾?,
    'image-lab': '鍗曠嫭娴嬭瘯鏂囩敓鍥俱€佸浘鍍忓弬鑰冨拰鍒嗛暅鍥剧墖鎻愮ず璇?,
    'music-mv': '鎸夋瓕璇嶈妭濂忕敓鎴愰煶涔?MV 鍒嗛暅銆佸瓧骞曞拰鍓槧鑽夌',
    'viral-analyzer': '鎷嗚В鐖嗘鐭棰戠殑寮€澶淬€佺粨鏋勩€佺粨灏惧拰鐖嗙偣',
    'prompt-templates': '绠＄悊绯荤粺妯℃澘銆佸厠闅嗐€佸鍏?JSON 鍜屾湰鍦扮紪杈?,
    'draft-templates': '璋冩暣鐢诲竷銆佸浘鐗囧尯鍩熴€佸瓧骞曘€佸厤璐ｅ０鏄庡拰闊抽鍙傛暟',
    settings: '閰嶇疆 API 鍑瘉銆佹湰鍦拌矾寰勩€乀TS銆両MA 涓庤瘖鏂?,
    account: '绠＄悊鏈満璐﹀彿璧勬枡銆佽澶囧拰妯℃嫙浣欓',
    activation: '绠＄悊鏈湴婵€娲荤姸鎬佷笌璇曠敤璇存槑',
  };
  if (view === 'voice-lab') return '鍗曠嫭璇曞惉璞嗗寘涓?MiniMax 闊宠壊锛屼繚瀛樻湰鍦拌瘯鍚褰?;
  return map[view] ?? '';
}

function pipelineStepStatus(task: Task, step: number): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
  if (task.status === 'paused' && task.failedStep === step) return 'failed';
  if (task.status === 'failed') return step === task.currentStep ? 'failed' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'cancelled') return step === task.currentStep ? 'cancelled' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'running') return step < task.currentStep ? 'completed' : step === task.currentStep ? 'running' : 'pending';
  return step < task.currentStep ? 'completed' : 'pending';
}

function statusLabelForStep(status: ReturnType<typeof pipelineStepStatus>): string {
  return {
    pending: '绛夊緟涓?,
    running: '杩涜涓?,
    completed: '宸插畬鎴?,
    failed: '澶辫触',
    cancelled: '宸插彇娑?,
  }[status];
}

function artifactPanelTitle(task: Task, tab: 'preview' | 'storyboard' | 'audio'): string {
  if (tab === 'storyboard') return task.currentStep >= 2 ? '鍒嗛暅鐢诲粖宸茶窡闅忔祦姘寸嚎鍑嗗' : '绛夊緟鍒嗛暅鐢熸垚';
  if (tab === 'audio') return task.currentStep >= 5 ? '閰嶉煶涓庡瓧骞曟椂闂磋酱' : '绛夊緟閰嶉煶鐢熸垚';
  return task.currentStep >= 7 ? '鏈€缁堝壀鏄犺崏绋跨洰褰? : '绛夊緟褰撳墠姝ラ浜х墿钀界洏';
}

function formatDuration(start: string, end: string | null, now = Date.now()): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return '--';
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`;
}

function statusLabel(status: TaskStatus | 'all'): string {
  return {
    all: '鍏ㄩ儴',
    draft: '鑽夌',
    pending: '绛夊緟',
    running: '杩愯涓?,
    paused: '鏆傚仠',
    completed: '宸插畬鎴?,
    failed: '澶辫触',
    cancelled: '宸插彇娑?,
  }[status];
}

function maskConfigured(value: string): string {
  if (!value) return '寰呴厤缃?;
  return value.length > 8 ? `${value.slice(0, 2)}鈥⑩€⑩€⑩€?{value.slice(-4)}` : '宸查厤缃?;
}

function settingsStatusLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '宸查厤缃? : status === 'warn' ? '闇€纭' : '寰呴厤缃?;
}

function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '鍙戠敓閿欒';
  const imageApiStatus = normalized.match(/Image provider API error \((\d+)\)/i)?.[1];
  if (imageApiStatus) return `鐢熷浘鎺ュ彛閿欒 ${imageApiStatus}`;
  if (/Python dependency .* is required|ModuleNotFoundError: No module named/i.test(normalized)) {
    const missing = normalized.match(/No module named ['"]([^'"]+)['"]/i)?.[1] ?? normalized.match(/Python dependency ([\w.-]+)/i)?.[1];
    return missing ? `Python 杩愯鏃剁己灏戜緷璧栵細${missing}` : 'Python 杩愯鏃朵緷璧栫己澶?;
  }
  if (normalized.includes(['Browser preview', 'cannot run the real provider pipeline'].join(' ')) || /娴忚鍣ㄩ瑙堟棤娉曡繍琛岀湡瀹炰緵搴斿晢娴佹按绾?i.test(normalized)) return '娴忚鍣ㄩ瑙堟棤娉曟墽琛岀湡瀹炰换鍔?;
  if (/Image provider API key is missing/i.test(normalized)) return '鐢熷浘 API Key 缂哄け';
  if (/Image provider is not configured/i.test(normalized)) return '鐢熷浘閰嶇疆涓嶅畬鏁?;
  if (/Jimeng submit failed/i.test(normalized)) return '鍗虫ⅵ鎻愪氦澶辫触';
  if (/Jimeng poll failed/i.test(normalized)) return '鍗虫ⅵ缁撴灉鑾峰彇澶辫触';
  if (/LLM provider is not configured/i.test(normalized)) return 'LLM 閰嶇疆涓嶅畬鏁?;
  if (/TTS provider is not configured/i.test(normalized)) return 'TTS 閰嶇疆涓嶅畬鏁?;
  const firstSentence = normalized.split(/[銆?!?]/)[0] || normalized;
  return trimForPreview(firstSentence, 42);
}

type ImageResolution = '1K' | '2K' | '4K';

function settingsConfigSignature(config: AppConfig): string {
  return JSON.stringify(normalizeEditableConfigProviders(config));
}

function imageProviderLabel(provider: ImageProviderProfile['provider']): string {
  return provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '鍗虫ⅵ' : '鑷畾涔夊浘鐗?;
}

function imageProfileSummary(profile: ImageProviderProfile): string {
  if (profile.provider === 'jimeng') return imageProfileJimeng(profile).reqKey || imageProfileJimeng(profile).model || '鏈厤缃?Req Key';
  if (profile.provider === 'custom') return imageProfileCustomImage(profile).model || '鏈€夋嫨妯″瀷';
  return imageProfileGptImage(profile).model || '鏈€夋嫨妯″瀷';
}

function ttsProviderLabel(provider: TtsProviderProfile['provider']): string {
  return provider === 'minimax' ? 'MiniMax' : '鐏北寮曟搸';
}

function ttsProfileSummary(profile: TtsProviderProfile): string {
  if (profile.provider === 'minimax') return ttsProfileMinimax(profile).model || '鏈€夋嫨妯″瀷';
  const speaker = ttsProfileVolcengine(profile).speaker;
  return volcengineVoicePresetLabel(speaker) || speaker || '鏈€夋嫨闊宠壊';
}

type VolcengineVoiceOption = {
  voiceType: string;
  label: string;
};

function mergeVolcengineSpeakers(current: VolcengineSpeaker[], incoming: VolcengineSpeaker[]): VolcengineSpeaker[] {
  const byVoiceType = new Map(current.map((speaker) => [speaker.voiceType, speaker]));
  incoming.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (voiceType) byVoiceType.set(voiceType, { ...speaker, voiceType });
  });
  return [...byVoiceType.values()];
}

function buildVolcengineVoiceOptions(speakers: VolcengineSpeaker[]): VolcengineVoiceOption[] {
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

function volcenginePresetVoiceValue(speaker: string, options: VolcengineVoiceOption[] = buildVolcengineVoiceOptions([])): string {
  return options.some((option) => option.voiceType === speaker) ? speaker : 'custom';
}

function volcengineVoicePresetLabel(speaker: string, speakers: VolcengineSpeaker[] = []): string {
  return buildVolcengineVoiceOptions(speakers).find((option) => option.voiceType === speaker)?.label ?? '';
}

function volcengineStaticPresetLabel(speaker: string): string {
  return volcengineVoicePresets.find(([, voiceType]) => voiceType === speaker)?.[0] ?? '';
}

function DraftCanvasText({
  className,
  x,
  y,
  width,
  border,
  positioned = true,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  width: number;
  border?: DraftTextBorder;
  positioned?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const positionStyle = positioned ? draftLayerPositionStyle(x, y) : {};
  return (
    <div className={className} style={{ ...positionStyle, ...draftTextWidthStyle(width), ...draftTextStrokeStyle(border), ...style }}>
      {children}
    </div>
  );
}

function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return applyDraftImageRatio({ ...template, canvas: { ...template.canvas, ...canvas, ratio } }, template.image.ratio);
}

function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const height = clamp(draftImageHeightForCanvas(template.canvas, ratio), 0.1, 1);
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      height,
      top: clamp((1 - height) / 2, -0.2, 1 - Math.min(0.1, height)),
    },
  };
}

function draftImageHeightForCanvas(canvas: DraftTemplate['canvas'], imageRatio: string): number {
  const ratio = ratioToNumber(imageRatio);
  if (!ratio) return 1;
  return (canvas.width / ratio) / canvas.height;
}

function draftTemplateCanvasStyle(template: DraftTemplate): React.CSSProperties {
  const backgroundImage = template.canvas.backgroundImage.trim();
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    '--draft-preview-width': `${draftPreviewWidth(template)}px`,
    '--draft-canvas-ratio': ratio,
    aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
    backgroundColor: template.canvas.backgroundColor,
    backgroundImage: backgroundImage ? `url("${toLocalImageUrl(backgroundImage).replace(/"/g, '\\"')}")` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
  };
  return style;
}

function draftPreviewWidth(template: DraftTemplate): number {
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  if (ratio >= 1.5) return 640;
  if (ratio >= 1.2) return 560;
  if (ratio >= 0.95) return 520;
  return Math.max(300, Math.round(ratio * 560));
}

function draftImageMediaStyle(template: DraftTemplate): React.CSSProperties {
  const aspectRatio = draftImageAspectRatio(template.image.ratio);
  if (template.image.fit === 'contain') {
    return {
      aspectRatio,
      height: 'auto',
      maxHeight: '100%',
      maxWidth: '100%',
      width: '100%',
    };
  }
  return {
    aspectRatio,
    height: '100%',
    width: '100%',
  };
}

function draftImageAspectRatio(ratio: string): string {
  const parts = ratio.split(':').map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '9 / 16';
}

function ratioToNumber(ratio: string): number {
  const [width, height] = ratio.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = normalizeColorInput(color).slice(1);
  const channel = (offset: number) => Number.parseInt(normalized.slice(offset, offset + 2), 16);
  const opacity = clamp(alpha, 0, 1);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${opacity})`;
}

function draftTextStrokeStyle(border?: DraftTextBorder): React.CSSProperties {
  if (!border || border.width <= 0 || border.alpha <= 0) return {};
  const color = colorWithAlpha(border.color, border.alpha);
  const previewStrokeWidth = Math.min(3, Math.max(1, Math.round(border.width / 16)));
  return {
    WebkitTextStroke: `${previewStrokeWidth}px ${color}`,
    paintOrder: 'stroke fill',
    textShadow: `0 1px 2px ${colorWithAlpha(border.color, Math.min(border.alpha, 0.55))}`,
  };
}

function draftTextBorderStyle(border?: DraftTextBorder): React.CSSProperties {
  return draftTextStrokeStyle(border);
}

function draftTextLayerStyle(
  text: Pick<DraftTemplate['title'], 'color' | 'alpha' | 'underline' | 'align' | 'letterSpacing' | 'lineSpacing'>,
  fontSize: number,
  fontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties {
  return {
    color: text.color,
    fontSize,
    opacity: text.alpha,
    fontWeight,
    textDecoration: text.underline ? 'underline' : 'none',
    textAlign: draftTextAlign(text.align),
    letterSpacing: `${text.letterSpacing}px`,
    lineHeight: `${1 + text.lineSpacing / 10}`,
  };
}

function draftTextWidthStyle(width: number): React.CSSProperties {
  return {
    width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`,
  };
}

function draftTextAlign(align: number): React.CSSProperties['textAlign'] {
  if (align <= 0) return 'left';
  if (align >= 2) return 'right';
  return 'center';
}

function isDraftLayerVisible(template: DraftTemplate, layer: DraftCanvasLayer): boolean {
  if (layer === 'image') return template.image.visible;
  if (layer === 'title') return template.title.visible;
  if (layer === 'subtitle') return template.subtitle.visible;
  if (layer === 'caption') return template.caption.visible;
  return template.disclaimer.visible;
}

function firstVisibleDraftLayer(template: DraftTemplate): DraftCanvasLayer {
  return (['image', 'title', 'subtitle', 'caption', 'disclaimer'] as DraftCanvasLayer[]).find((layer) => isDraftLayerVisible(template, layer)) ?? 'title';
}

function updateDraftLayerPosition(template: DraftTemplate, layer: DraftCanvasLayer, deltaX: number, deltaY: number): DraftTemplate {
  if (layer === 'image') {
    return {
      ...template,
      image: {
        ...template.image,
        top: clamp(template.image.top + deltaY / 2, -0.2, 1 - Math.min(0.1, template.image.height)),
      },
    };
  }
  if (layer === 'title') {
    return { ...template, title: { ...template.title, x: clamp(template.title.x + deltaX, -0.9, 0.9), y: clamp(template.title.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'subtitle') {
    return { ...template, subtitle: { ...template.subtitle, x: clamp(template.subtitle.x + deltaX, -0.9, 0.9), y: clamp(template.subtitle.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'caption') {
    return { ...template, caption: { ...template.caption, x: clamp(template.caption.x + deltaX, -0.9, 0.9), y: clamp(template.caption.y + deltaY, -0.9, 0.9) } };
  }
  return { ...template, disclaimer: { ...template.disclaimer, x: clamp(template.disclaimer.x + deltaX, -0.9, 0.9), y: clamp(template.disclaimer.y + deltaY, -0.95, 0.95) } };
}

function resizeDraftLayerWidth(template: DraftTemplate, layer: Exclude<DraftCanvasLayer, 'image'>, deltaX: number): DraftTemplate {
  if (layer === 'title') return { ...template, title: { ...template.title, width: clamp(template.title.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'subtitle') return { ...template, subtitle: { ...template.subtitle, width: clamp(template.subtitle.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'caption') return { ...template, caption: { ...template.caption, width: clamp(template.caption.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  return { ...template, disclaimer: { ...template.disclaimer, width: clamp(template.disclaimer.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
}

function draftLayerPositionStyle(x: number, y: number): React.CSSProperties {
  return {
    left: `${((x + 1) / 2) * 100}%`,
    top: `${((y + 1) / 2) * 100}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setDraftModel(config: AppConfig, key: ModelListKey, model: string): AppConfig {
  if (key === 'gpt-image') {
    return { ...config, gptImage: { ...config.gptImage, model } };
  }
  if (key === 'custom-image') {
    return { ...config, customImage: { ...config.customImage, model } };
  }
  return saveLlmProfile(config, { ...config.llm, model });
}

function setImageResolution(config: AppConfig, resolution: ImageResolution): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, resolution } };
  }
  return { ...config, image: { ...config.image, resolution }, gptImage: { ...config.gptImage, resolution } };
}

function activeImageResolution(config: AppConfig): ImageResolution {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

function setImageConcurrency(config: AppConfig, concurrency: number): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, concurrency } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, concurrency } };
  }
  return { ...config, image: { ...config.image, concurrency }, gptImage: { ...config.gptImage, concurrency } };
}

function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

function snapshotStepStatus(snapshot: TaskArtifactSnapshot | null, step: number): string {
  return snapshot?.steps[String(step)]?.status ?? 'pending';
}

function imageProgressLabel(totalScenes: number, generatedImages: number, stepStatus: string): string {
  const total = totalScenes || generatedImages;
  if (total === 0) return '绛夊緟鍒嗛暅';
  const statusText = stepStatus === 'completed' ? '宸插畬鎴? : stepStatus === 'running' ? '鐢熸垚涓? : stepStatus === 'failed' ? '鐢熸垚澶辫触' : '绛夊緟鐢熷浘';
  return `${generatedImages}/${total} 寮?路 ${statusText}`;
}

function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function toLocalAssetUrl(path: string): string {
  return toLocalImageUrl(path);
}

function countChars(value?: string): number {
  return value?.trim().length ?? 0;
}

function normalizeTaskTargetLength(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(5000, Math.max(100, Math.round(parsed)));
}

function normalizeTaskStoryboardSceneCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(60, Math.max(1, Math.round(parsed)));
}

function trimForPreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function cloneDraftTemplate(template: DraftTemplate): DraftTemplate {
  return JSON.parse(JSON.stringify(template)) as DraftTemplate;
}

function toggleArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function sourceKey(source: AiSourceSection, index: number): string {
  return source.url || `${source.title}-${index}`;
}

declare global {
  interface Window {
    __storydreamReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

window.__storydreamReactRoot ??= createRoot(rootElement);
window.__storydreamReactRoot.render(<App />);

