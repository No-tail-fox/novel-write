// Extracted from existing generation paths. Prompt text stays in the lazy corpus.
import type { PromptChannel } from './types';
export interface WorkflowPromptDescriptor { slot: string; name: string; channel: PromptChannel; source: string; variables: Record<string, string>; baseTrack?: string; }
export const workflowPromptCatalog: readonly WorkflowPromptDescriptor[] = [
  {
    "slot": "research-copy",
    "name": "资料文案 · 创作系统规则",
    "channel": "shared",
    "source": "src/shared/research.ts",
    "variables": {
      "input_trackName": "input.trackName",
      "input_trackTag": "input.trackTag",
      "strategy": "strategy",
      "value4": "运行时根据当前项目计算",
      "noReferenceExtra": "noReferenceExtra"
    }
  },
  {
    "slot": "html-planning",
    "name": "HTML 动画 · 场景规划",
    "channel": "html-video",
    "source": "src/shared/task-runtime-providers.ts",
    "variables": {
      "HYPERFRAMES_AUTHORING_RULES": "HYPERFRAMES_AUTHORING_RULES",
      "orientation": "orientation",
      "templates": "templates",
      "elementRule": "elementRule"
    }
  },
  {
    "slot": "html-rewrite",
    "name": "HTML 动画 · 文案改写",
    "channel": "html-video",
    "source": "src/shared/task-runtime-providers.ts",
    "variables": {}
  },
  {
    "slot": "vox-code",
    "name": "创意动画 · Remotion 代码生成",
    "channel": "editorial-collage",
    "source": "src/shared/vox-animation-prompt.ts",
    "variables": {}
  },
  {
    "slot": "story-narrative",
    "name": "短片 · 叙事规划",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-platform",
    "name": "短片 · 平台适配",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-rewrite-contract-1",
    "name": "短片 · 改写与评选输出协议 1",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-rewrite-contract-2",
    "name": "短片 · 改写与评选输出协议 2",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-cover-contract",
    "name": "短片 · 封面输出协议",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-length-repair",
    "name": "短片 · 篇幅修复",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-character",
    "name": "短片 · 角色档案",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "story-image-contract",
    "name": "短片 · 绘图输出协议",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {}
  },
  {
    "slot": "editorial-scene",
    "name": "创意动画 · 纸拼贴场景",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {
      "input_ratio": "input.ratio",
      "intent": "intent",
      "imageRules": "imageRules",
      "value4": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "editorial-layer",
    "name": "创意动画 · 纸拼贴图层",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {
      "value1": "运行时根据当前项目计算",
      "value2": "运行时根据当前项目计算",
      "value3": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "creative-scene",
    "name": "创意动画 · 场景画面简报",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/image-prompts.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "creative-layer",
    "name": "创意动画 · 分层素材简报",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/image-prompts.ts",
    "variables": {
      "value1": "运行时根据当前项目计算",
      "value2": "运行时根据当前项目计算",
      "value3": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "music-mv-image",
    "name": "音乐 MV · 镜头画面提示词",
    "channel": "music-mv",
    "source": "src/shared/runner.ts",
    "variables": {
      "task_style": "task.style",
      "value2": "运行时根据当前项目计算",
      "musicPlan_captionStyle": "musicPlan.captionStyle",
      "musicPlan_rhythmMode": "musicPlan.rhythmMode",
      "value5": "运行时根据当前项目计算",
      "scene_descPrompt": "scene.descPrompt"
    }
  },
  {
    "slot": "creative-plan",
    "name": "创意动画 · 预设画面规划",
    "channel": "editorial-collage",
    "source": "electron/vox-production-runtime.ts",
    "variables": {
      "strategy": "strategy",
      "imageStrategy": "imageStrategy",
      "value3": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "html-foreground",
    "name": "HTML 动画 · 前景素材规则",
    "channel": "html-video",
    "source": "src/shared/task-runtime-providers.ts",
    "variables": {}
  },
  {
    "slot": "writing-track:character-story",
    "name": "内容赛道 · 人物故事",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "character-story"
  },
  {
    "slot": "writing-track:folk-tale",
    "name": "内容赛道 · 民间故事",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "folk-tale"
  },
  {
    "slot": "writing-track:ecommerce",
    "name": "内容赛道 · 电商带货",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "ecommerce"
  },
  {
    "slot": "writing-track:book-product",
    "name": "内容赛道 · 好书带货",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "book-product"
  },
  {
    "slot": "writing-track:knowledge",
    "name": "内容赛道 · 知识科普",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "knowledge"
  },
  {
    "slot": "writing-track:culture-knowledge",
    "name": "内容赛道 · 文化科普",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "culture-knowledge"
  },
  {
    "slot": "writing-track:picture-book",
    "name": "内容赛道 · 绘本故事",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "picture-book"
  },
  {
    "slot": "writing-track:health-book",
    "name": "内容赛道 · 健康图书",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "health-book"
  },
  {
    "slot": "writing-track:inspirational",
    "name": "内容赛道 · 情感共鸣",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "inspirational"
  },
  {
    "slot": "writing-track:food-vlog",
    "name": "内容赛道 · 美食探店",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "food-vlog"
  },
  {
    "slot": "writing-track:general",
    "name": "内容赛道 · 通用故事",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {},
    "baseTrack": "general"
  },
  {
    "slot": "writing-style:documentary",
    "name": "文案风格 · 纪实解释",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "writing-style:story",
    "name": "文案风格 · 故事叙事",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "writing-style:commentary",
    "name": "文案风格 · 观点评论",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "writing-style:popular-science",
    "name": "文案风格 · 轻松科普",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "writing-style:data",
    "name": "文案风格 · 数据解读",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "writing-style:cultural-essay",
    "name": "文案风格 · 文化随笔",
    "channel": "shared",
    "source": "src/shared/editorial-writing-styles.ts",
    "variables": {}
  },
  {
    "slot": "comic-speaker-repair",
    "name": "漫剧 · 对白归属修复",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-planner.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "comic-script",
    "name": "漫剧 · 剧本与资产规划",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-planner.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "comic-storyboard",
    "name": "漫剧 · 分镜导演",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-planner.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "comic-episodes",
    "name": "漫剧 · 分集边界规划",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-episode-planner.ts",
    "variables": {
      "value1": "运行时根据当前项目计算",
      "value2": "运行时根据当前项目计算",
      "input_targetCharacters": "input.targetCharacters",
      "value4": "运行时根据当前项目计算",
      "value5": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "lemo-system",
    "name": "创意动画 · Lemo 导演与代码协议",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {
      "value1": "运行时根据当前项目计算",
      "reference": "reference"
    }
  },
  {
    "slot": "comic-repair",
    "name": "漫剧 · 剧本分镜校验修复",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-planner.ts",
    "variables": {
      "stage": "stage",
      "value2": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "research-strategy-1",
    "name": "公共文案 · 素材策略 1",
    "channel": "shared",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "research-strategy-2",
    "name": "公共文案 · 素材策略 2",
    "channel": "shared",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "research-strategy-3",
    "name": "公共文案 · 素材策略 3",
    "channel": "shared",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "research-strategy-4",
    "name": "公共文案 · 素材策略 4",
    "channel": "shared",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "story-review-strategy-1",
    "name": "短片预审 · 素材策略 1",
    "channel": "story",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "story-review-strategy-2",
    "name": "短片预审 · 素材策略 2",
    "channel": "story",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "story-review-strategy-3",
    "name": "短片预审 · 素材策略 3",
    "channel": "story",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "story-review-strategy-4",
    "name": "短片预审 · 素材策略 4",
    "channel": "story",
    "source": "src/shared/research.ts",
    "variables": {}
  },
  {
    "slot": "story-review-system",
    "name": "短片 · 预审系统协议",
    "channel": "story",
    "source": "src/shared/research.ts",
    "variables": {
      "value1": "运行时根据当前项目计算",
      "value2": "运行时根据当前项目计算",
      "track_trackTag": "track.trackTag",
      "value4": "运行时根据当前项目计算",
      "strategy": "strategy",
      "value6": "运行时根据当前项目计算",
      "value7": "运行时根据当前项目计算",
      "value8": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "writing-expression",
    "name": "公共文案 · 新媒体表达",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {}
  },
  {
    "slot": "writing-refinement",
    "name": "公共文案 · 精修与优先级",
    "channel": "shared",
    "source": "src/shared/copywriting-tracks.ts",
    "variables": {}
  },
  {
    "slot": "comic-episodes-repair",
    "name": "漫剧 · 分集校验修复",
    "channel": "motion-comic",
    "source": "src/shared/motion-comic-episode-planner.ts",
    "variables": {
      "batch_index": "batch.index",
      "value2": "运行时根据当前项目计算",
      "value3": "运行时根据当前项目计算",
      "value4": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "lemo-stage-1",
    "name": "Lemo · Return only JSON {\"treatment\":\"complete treatment in Chinese\",\"fps\":",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-2",
    "name": "Lemo · Write the treatment first: three candidate structures and your choic",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-3",
    "name": "Lemo · Return ONLY one complete HTML document, no Markdown. Use Canvas2D, W",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-4",
    "name": "Lemo · Implement the original protocol: window.DUR in seconds must equal th",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-5",
    "name": "Lemo · Use seeded random from core/lib.js; no wall-clock animation or unsee",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-6",
    "name": "Lemo · ES module imports available locally: \"three\" (0.170.0), \"./core/lib.",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-7",
    "name": "Lemo · Own all visible text including subtitles, integrated into this style",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-stage-8",
    "name": "Lemo · The host mixes the supplied voice and user-selected music. Do not pl",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/native-film.ts",
    "variables": {}
  },
  {
    "slot": "lemo-batch-1",
    "name": "Lemo · Create reusable canvas, palette, typography, prepared assets and dra",
    "channel": "editorial-collage",
    "source": "electron/lemo-incremental-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-batch-2",
    "name": "Lemo · Compose scenes and transitions over absolute time; aggregate active ",
    "channel": "editorial-collage",
    "source": "electron/lemo-incremental-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-batch-3",
    "name": "Lemo · Implement only assigned shot windows using shared APIs (target <=600",
    "channel": "editorial-collage",
    "source": "electron/lemo-incremental-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-batch-4",
    "name": "Lemo · Return strict JSON {baseHash, edits:[{search,replace}], done:boolean",
    "channel": "editorial-collage",
    "source": "electron/lemo-incremental-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-batch-5",
    "name": "Lemo · Factory parameters (input,shared,scenes,core,THREE). Shared returns ",
    "channel": "editorial-collage",
    "source": "electron/lemo-incremental-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-file-1",
    "name": "创意动画 · 工程文件协议 1",
    "channel": "editorial-collage",
    "source": "electron/lemo-project-runtime.ts",
    "variables": {}
  },
  {
    "slot": "lemo-file-2",
    "name": "创意动画 · 工程文件协议 2",
    "channel": "editorial-collage",
    "source": "electron/lemo-project-runtime.ts",
    "variables": {}
  },
  {
    "slot": "lemo-file-3",
    "name": "创意动画 · 工程文件协议 3",
    "channel": "editorial-collage",
    "source": "electron/lemo-project-runtime.ts",
    "variables": {}
  },
  {
    "slot": "lemo-file-4",
    "name": "创意动画 · 工程文件协议 4",
    "channel": "editorial-collage",
    "source": "electron/lemo-project-runtime.ts",
    "variables": {}
  },
  {
    "slot": "lemo-host-1",
    "name": "创意动画 · 分批创作宿主 1",
    "channel": "editorial-collage",
    "source": "electron/main.ts",
    "variables": {}
  },
  {
    "slot": "lemo-host-2",
    "name": "创意动画 · 分批创作宿主 2",
    "channel": "editorial-collage",
    "source": "electron/main.ts",
    "variables": {}
  },
  {
    "slot": "director-copy-1",
    "name": "创意动画 · 完整原稿篇幅规则",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "director-copy-2",
    "name": "AI 漫剧 · 核心设定格式",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "director-copy-3",
    "name": "创意动画 · 原稿修改规则",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "director-copy-4",
    "name": "AI 漫剧 · 设定修改规则",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "director-copy-5",
    "name": "创意动画 · 用户要求优先级",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "editorial-intent-1",
    "name": "创意动画 · 画面意图 1",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "editorial-intent-2",
    "name": "创意动画 · 画面意图 2",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "editorial-target-1",
    "name": "创意动画 · 图片输出目标 1",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "editorial-target-2",
    "name": "创意动画 · 图片输出目标 2",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "editorial-target-3",
    "name": "创意动画 · 图片输出目标 3",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "editorial-target-4",
    "name": "创意动画 · 图片输出目标 4",
    "channel": "editorial-collage",
    "source": "src/shared/editorial-image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "creative-target-1",
    "name": "创意动画 · 材质图片输出目标 1",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/image-prompts.ts",
    "variables": {}
  },
  {
    "slot": "story-tail-anchors",
    "name": "短片 · 分镜尾句锚点协议",
    "channel": "story",
    "source": "src/shared/runner.ts",
    "variables": {
      "storyboardSceneSplittingRules": "storyboardSceneSplittingRules"
    }
  },
  {
    "slot": "html-authoring",
    "name": "HTML 动画 · HyperFrames 宿主协议",
    "channel": "html-video",
    "source": "src/shared/html-video-authoring.ts",
    "variables": {}
  },
  {
    "slot": "lemo-director-reference",
    "name": "Lemo · 导演方法参考",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/DIRECTOR.md",
    "variables": {}
  },
  {
    "slot": "lemo-technique-reference",
    "name": "Lemo · 技术参考",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/TECHNIQUE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:caption-news",
    "name": "Lemo 完整风格 · 字幕新闻",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/caption-news/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:newsreel",
    "name": "Lemo 完整风格 · 1920s 新闻影片",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/newsreel/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:countdown",
    "name": "Lemo 完整风格 · 实时倒计时分屏",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/countdown/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:city-symphony",
    "name": "Lemo 完整风格 · 延时交响",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/city-symphony/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:visual-investigation",
    "name": "Lemo 完整风格 · 视觉调查",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/visual-investigation/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:kino-montage",
    "name": "Lemo 完整风格 · 构成主义蒙太奇",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/kino-montage/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:telestrator",
    "name": "Lemo 完整风格 · 体育战术板",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/telestrator/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:news-package",
    "name": "Lemo 完整风格 · 电视新闻包装",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/news-package/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:satellite-briefing",
    "name": "Lemo 完整风格 · 卫星简报",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/satellite-briefing/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:briefing-board",
    "name": "Lemo 完整风格 · 工程简报板",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/briefing-board/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:lidar-survey",
    "name": "Lemo 完整风格 · 点云测绘",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/lidar-survey/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:white-model",
    "name": "Lemo 完整风格 · 白模投影",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/white-model/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:data-physical",
    "name": "Lemo 完整风格 · 数据实物化",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/data-physical/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:teardown",
    "name": "Lemo 完整风格 · 产品拆解",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/teardown/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:microscope",
    "name": "Lemo 完整风格 · 显微叙事",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/microscope/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:archive-lighttable",
    "name": "Lemo 完整风格 · 档案灯台",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/archive-lighttable/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:crayon-book",
    "name": "Lemo 完整风格 · 蜡笔儿童绘本",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/crayon-book/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:watercolor",
    "name": "Lemo 完整风格 · 水彩笔刷",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/watercolor/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:ink-wash",
    "name": "Lemo 完整风格 · 中国水墨",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/ink-wash/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:impasto",
    "name": "Lemo 完整风格 · 油画厚涂",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/impasto/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:one-line",
    "name": "Lemo 完整风格 · 一笔画",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/one-line/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:whiteboard",
    "name": "Lemo 完整风格 · 白板讲解",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/whiteboard/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:urban-sketch",
    "name": "Lemo 完整风格 · 钢笔淡彩",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/urban-sketch/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:shadow-puppet",
    "name": "Lemo 完整风格 · 皮影戏",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/shadow-puppet/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:ukiyoe",
    "name": "Lemo 完整风格 · 浮世绘",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/ukiyoe/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:papercut-red",
    "name": "Lemo 完整风格 · 红色窗花剪纸",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/papercut-red/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:paper-lantern",
    "name": "Lemo 完整风格 · 纸雕灯影",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/paper-lantern/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:risograph",
    "name": "Lemo 完整风格 · Risograph 孔版印刷",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/risograph/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:halftone-dossier",
    "name": "Lemo 完整风格 · 复古半调案卷",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/halftone-dossier/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:woodcut",
    "name": "Lemo 完整风格 · 木刻版画",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/woodcut/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:engraving",
    "name": "Lemo 完整风格 · 铜版画",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/engraving/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:silkscreen-poster",
    "name": "Lemo 完整风格 · 丝印旅行海报",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/silkscreen-poster/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:swiss-motion",
    "name": "Lemo 完整风格 · 瑞士动态排版",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/swiss-motion/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:spy-titles",
    "name": "Lemo 完整风格 · 60s 间谍片头",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/spy-titles/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:art-deco",
    "name": "Lemo 完整风格 · 装饰艺术",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/art-deco/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:blueprint",
    "name": "Lemo 完整风格 · 蓝图 / 工程制图",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/blueprint/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:stained-glass",
    "name": "Lemo 完整风格 · 彩色玻璃窗",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/stained-glass/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:pictogram-motion",
    "name": "Lemo 完整风格 · 象形运动图形",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/pictogram-motion/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:ascii-crt",
    "name": "Lemo 完整风格 · ASCII / CRT 终端",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/ascii-crt/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:dataviz",
    "name": "Lemo 完整风格 · 数据叙事",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/dataviz/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:iso-infographic",
    "name": "Lemo 完整风格 · 等距信息图",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/iso-infographic/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:dark-keynote",
    "name": "Lemo 完整风格 · 暗色科技发布",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/dark-keynote/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:living-screencast",
    "name": "Lemo 完整风格 · 活体实机录屏",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/living-screencast/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:hologram-hud",
    "name": "Lemo 完整风格 · 科幻全息界面",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/hologram-hud/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:rubber-hose",
    "name": "Lemo 完整风格 · 1930s 橡皮管卡通",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/rubber-hose/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:cel-anime-80s",
    "name": "Lemo 完整风格 · 80 年代赛璐璐动画",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/cel-anime-80s/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:scifi-toon",
    "name": "Lemo 完整风格 · 科幻情景喜剧卡通",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/scifi-toon/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:midcentury-toon",
    "name": "Lemo 完整风格 · 50s 扁平卡通",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/midcentury-toon/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:pixel-rpg",
    "name": "Lemo 完整风格 · 16-bit 像素 RPG",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/pixel-rpg/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:hd-2d",
    "name": "Lemo 完整风格 · HD-2D",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/hd-2d/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:microgame",
    "name": "Lemo 完整风格 · 微游戏快闪",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/microgame/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:game-show",
    "name": "Lemo 完整风格 · 综艺节奏扁平",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/game-show/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:silent-film",
    "name": "Lemo 完整风格 · 1920s 默片",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/silent-film/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:backrooms",
    "name": "Lemo 完整风格 · 后室 / 新怪谈",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/backrooms/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:brick-toy",
    "name": "Lemo 完整风格 · 积木玩具",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/brick-toy/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:paper-popup",
    "name": "Lemo 完整风格 · 纸片立体书",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/paper-popup/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:tilt-shift",
    "name": "Lemo 完整风格 · 移轴微缩",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/tilt-shift/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:lowpoly-island",
    "name": "Lemo 完整风格 · 低多边形等距",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/lowpoly-island/STYLE.md",
    "variables": {}
  },
  {
    "slot": "lemo-style:glass-product",
    "name": "Lemo 完整风格 · 玻璃质感产品",
    "channel": "editorial-collage",
    "source": "vendor/lemo-opuscar/styles/glass-product/STYLE.md",
    "variables": {}
  },
  {
    "slot": "director-format-1",
    "name": "创意动画 · 旁白篇幅 1",
    "channel": "editorial-collage",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "director-format-2",
    "name": "创意动画 · 旁白篇幅 2",
    "channel": "editorial-collage",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {
      "voxSeconds": "voxSeconds",
      "voxTargetLength": "voxTargetLength",
      "value3": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "html-elements-1",
    "name": "HTML 动画 · 前景素材协议 1",
    "channel": "html-video",
    "source": "src/shared/task-runtime-providers.ts",
    "variables": {}
  },
  {
    "slot": "html-elements-2",
    "name": "HTML 动画 · 前景素材协议 2",
    "channel": "html-video",
    "source": "src/shared/task-runtime-providers.ts",
    "variables": {}
  },
  {
    "slot": "creative-strategy-1",
    "name": "创意动画 · 素材计划策略 1",
    "channel": "editorial-collage",
    "source": "electron/vox-production-runtime.ts",
    "variables": {}
  },
  {
    "slot": "creative-strategy-2",
    "name": "创意动画 · 素材计划策略 2",
    "channel": "editorial-collage",
    "source": "electron/vox-production-runtime.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "creative-strategy-3",
    "name": "创意动画 · 素材计划策略 3",
    "channel": "editorial-collage",
    "source": "electron/vox-production-runtime.ts",
    "variables": {
      "value1": "运行时根据当前项目计算"
    }
  },
  {
    "slot": "creative-image-strategy-1",
    "name": "创意动画 · 禁用生图策略 1",
    "channel": "editorial-collage",
    "source": "electron/vox-production-runtime.ts",
    "variables": {}
  },
  {
    "slot": "director-format-output",
    "name": "创意动画 · 旁白输出格式",
    "channel": "editorial-collage",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {
      "voxFormat": "voxFormat"
    }
  },
  {
    "slot": "director-original",
    "name": "公共文案 · 原创主题规则",
    "channel": "shared",
    "source": "src/shared/director-copy-assist.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:caption-news",
    "name": "视觉风格 · 字幕新闻 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:caption-news",
    "name": "视觉风格 · 字幕新闻 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:newsreel",
    "name": "视觉风格 · 1920s 新闻影片 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:newsreel",
    "name": "视觉风格 · 1920s 新闻影片 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:countdown",
    "name": "视觉风格 · 实时倒计时分屏 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:countdown",
    "name": "视觉风格 · 实时倒计时分屏 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:city-symphony",
    "name": "视觉风格 · 延时交响 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:city-symphony",
    "name": "视觉风格 · 延时交响 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:visual-investigation",
    "name": "视觉风格 · 视觉调查 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:visual-investigation",
    "name": "视觉风格 · 视觉调查 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:kino-montage",
    "name": "视觉风格 · 构成主义蒙太奇 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:kino-montage",
    "name": "视觉风格 · 构成主义蒙太奇 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:telestrator",
    "name": "视觉风格 · 体育战术板 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:telestrator",
    "name": "视觉风格 · 体育战术板 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:news-package",
    "name": "视觉风格 · 电视新闻包装 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:news-package",
    "name": "视觉风格 · 电视新闻包装 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:satellite-briefing",
    "name": "视觉风格 · 卫星简报 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:satellite-briefing",
    "name": "视觉风格 · 卫星简报 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:briefing-board",
    "name": "视觉风格 · 工程简报板 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:briefing-board",
    "name": "视觉风格 · 工程简报板 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:lidar-survey",
    "name": "视觉风格 · 点云测绘 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:lidar-survey",
    "name": "视觉风格 · 点云测绘 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:white-model",
    "name": "视觉风格 · 白模投影 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:white-model",
    "name": "视觉风格 · 白模投影 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:data-physical",
    "name": "视觉风格 · 数据实物化 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:data-physical",
    "name": "视觉风格 · 数据实物化 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:teardown",
    "name": "视觉风格 · 产品拆解 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:teardown",
    "name": "视觉风格 · 产品拆解 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:microscope",
    "name": "视觉风格 · 显微叙事 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:microscope",
    "name": "视觉风格 · 显微叙事 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:archive-lighttable",
    "name": "视觉风格 · 档案灯台 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:archive-lighttable",
    "name": "视觉风格 · 档案灯台 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:crayon-book",
    "name": "视觉风格 · 蜡笔儿童绘本 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:crayon-book",
    "name": "视觉风格 · 蜡笔儿童绘本 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:watercolor",
    "name": "视觉风格 · 水彩笔刷 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:watercolor",
    "name": "视觉风格 · 水彩笔刷 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:ink-wash",
    "name": "视觉风格 · 中国水墨 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:ink-wash",
    "name": "视觉风格 · 中国水墨 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:impasto",
    "name": "视觉风格 · 油画厚涂 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:impasto",
    "name": "视觉风格 · 油画厚涂 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:one-line",
    "name": "视觉风格 · 一笔画 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:one-line",
    "name": "视觉风格 · 一笔画 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:whiteboard",
    "name": "视觉风格 · 白板讲解 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:whiteboard",
    "name": "视觉风格 · 白板讲解 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:urban-sketch",
    "name": "视觉风格 · 钢笔淡彩 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:urban-sketch",
    "name": "视觉风格 · 钢笔淡彩 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:shadow-puppet",
    "name": "视觉风格 · 皮影戏 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:shadow-puppet",
    "name": "视觉风格 · 皮影戏 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:ukiyoe",
    "name": "视觉风格 · 浮世绘 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:ukiyoe",
    "name": "视觉风格 · 浮世绘 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:papercut-red",
    "name": "视觉风格 · 红色窗花剪纸 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:papercut-red",
    "name": "视觉风格 · 红色窗花剪纸 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:paper-lantern",
    "name": "视觉风格 · 纸雕灯影 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:paper-lantern",
    "name": "视觉风格 · 纸雕灯影 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:risograph",
    "name": "视觉风格 · Risograph 孔版印刷 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:risograph",
    "name": "视觉风格 · Risograph 孔版印刷 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:halftone-dossier",
    "name": "视觉风格 · 复古半调案卷 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:halftone-dossier",
    "name": "视觉风格 · 复古半调案卷 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:woodcut",
    "name": "视觉风格 · 木刻版画 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:woodcut",
    "name": "视觉风格 · 木刻版画 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:engraving",
    "name": "视觉风格 · 铜版画 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:engraving",
    "name": "视觉风格 · 铜版画 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:silkscreen-poster",
    "name": "视觉风格 · 丝印旅行海报 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:silkscreen-poster",
    "name": "视觉风格 · 丝印旅行海报 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:swiss-motion",
    "name": "视觉风格 · 瑞士动态排版 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:swiss-motion",
    "name": "视觉风格 · 瑞士动态排版 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:spy-titles",
    "name": "视觉风格 · 60s 间谍片头 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:spy-titles",
    "name": "视觉风格 · 60s 间谍片头 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:art-deco",
    "name": "视觉风格 · 装饰艺术 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:art-deco",
    "name": "视觉风格 · 装饰艺术 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:blueprint",
    "name": "视觉风格 · 蓝图 / 工程制图 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:blueprint",
    "name": "视觉风格 · 蓝图 / 工程制图 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:stained-glass",
    "name": "视觉风格 · 彩色玻璃窗 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:stained-glass",
    "name": "视觉风格 · 彩色玻璃窗 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:pictogram-motion",
    "name": "视觉风格 · 象形运动图形 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:pictogram-motion",
    "name": "视觉风格 · 象形运动图形 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:ascii-crt",
    "name": "视觉风格 · ASCII / CRT 终端 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:ascii-crt",
    "name": "视觉风格 · ASCII / CRT 终端 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:dataviz",
    "name": "视觉风格 · 数据叙事 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:dataviz",
    "name": "视觉风格 · 数据叙事 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:iso-infographic",
    "name": "视觉风格 · 等距信息图 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:iso-infographic",
    "name": "视觉风格 · 等距信息图 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:dark-keynote",
    "name": "视觉风格 · 暗色科技发布 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:dark-keynote",
    "name": "视觉风格 · 暗色科技发布 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:living-screencast",
    "name": "视觉风格 · 活体实机录屏 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:living-screencast",
    "name": "视觉风格 · 活体实机录屏 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:hologram-hud",
    "name": "视觉风格 · 科幻全息界面 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:hologram-hud",
    "name": "视觉风格 · 科幻全息界面 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:rubber-hose",
    "name": "视觉风格 · 1930s 橡皮管卡通 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:rubber-hose",
    "name": "视觉风格 · 1930s 橡皮管卡通 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:cel-anime-80s",
    "name": "视觉风格 · 80 年代赛璐璐动画 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:cel-anime-80s",
    "name": "视觉风格 · 80 年代赛璐璐动画 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:scifi-toon",
    "name": "视觉风格 · 科幻情景喜剧卡通 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:scifi-toon",
    "name": "视觉风格 · 科幻情景喜剧卡通 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:midcentury-toon",
    "name": "视觉风格 · 50s 扁平卡通 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:midcentury-toon",
    "name": "视觉风格 · 50s 扁平卡通 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:pixel-rpg",
    "name": "视觉风格 · 16-bit 像素 RPG · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:pixel-rpg",
    "name": "视觉风格 · 16-bit 像素 RPG · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:hd-2d",
    "name": "视觉风格 · HD-2D · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:hd-2d",
    "name": "视觉风格 · HD-2D · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:microgame",
    "name": "视觉风格 · 微游戏快闪 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:microgame",
    "name": "视觉风格 · 微游戏快闪 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:game-show",
    "name": "视觉风格 · 综艺节奏扁平 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:game-show",
    "name": "视觉风格 · 综艺节奏扁平 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:silent-film",
    "name": "视觉风格 · 1920s 默片 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:silent-film",
    "name": "视觉风格 · 1920s 默片 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:backrooms",
    "name": "视觉风格 · 后室 / 新怪谈 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:backrooms",
    "name": "视觉风格 · 后室 / 新怪谈 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:brick-toy",
    "name": "视觉风格 · 积木玩具 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:brick-toy",
    "name": "视觉风格 · 积木玩具 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:paper-popup",
    "name": "视觉风格 · 纸片立体书 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:paper-popup",
    "name": "视觉风格 · 纸片立体书 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:tilt-shift",
    "name": "视觉风格 · 移轴微缩 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:tilt-shift",
    "name": "视觉风格 · 移轴微缩 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:lowpoly-island",
    "name": "视觉风格 · 低多边形等距 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:lowpoly-island",
    "name": "视觉风格 · 低多边形等距 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-image:glass-product",
    "name": "视觉风格 · 玻璃质感产品 · 图像指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  },
  {
    "slot": "creative-motion:glass-product",
    "name": "视觉风格 · 玻璃质感产品 · 动作指导",
    "channel": "editorial-collage",
    "source": "src/shared/creative-animation/adapters.ts",
    "variables": {}
  }
];
