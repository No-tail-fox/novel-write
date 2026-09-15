export const EDITORIAL_RECIPE_IDS = ['paper-cut', 'vox-narrated', 'collage-broll', 'nantian'] as const;
export type EditorialRecipeId = typeof EDITORIAL_RECIPE_IDS[number];

/** Product-owned adapters; upstream skills remain installed in the user's agent directory. */
export const EDITORIAL_RECIPES = [
  { id: 'paper-cut', label: '原画参考分层 · Paper Cut', engine: 'deterministic-layers', description: '先生成构图原画，再以原画为参考制作独立背景和透明主体，由本地时间线编排。', imagePrompt: 'Editorial paper collage with physical paper grain, torn edges and layered shadows. Establish one clear hero subject and a restrained supporting object.', motionPrompt: '主体纸片先滑入并落定，辅助物件随后展开；背景保持安静，前景遮挡形成浅视差。' },
  { id: 'vox-narrated', label: '旁白拼贴动画 · VOX', engine: 'remotion', description: '使用 Remotion 分层模板或 AI 代码。生成代码时以旁白时间戳安排纸片、图表与文字动作。', imagePrompt: 'Documentary editorial collage with independent photographic cutouts, paper texture, precise code-drawn labels and evidence.', motionPrompt: '以真实旁白为时间基准，主体、证据和结论依次揭示；每个镜头只解释一个命题。' },
  { id: 'collage-broll', label: '口播配画面 · gbro', engine: 'living-poster', description: '将当前口播压成一个视觉隐喻，生成半调纸拼贴关键帧，再制作逐件组装的视频。适合短镜头。', imagePrompt: 'One visual metaphor for the narration. Flat saturated paper background, monochrome halftone photographic cutouts and at most four meaningful object groups, arranged for sequential assembly.', motionPrompt: '从简洁色场开始，围绕当前口播的一个视觉隐喻，让不超过四组纸片依次滑入、卡位、组装，最后停稳；保留半调、纸边和阴影。' },
  { id: 'nantian', label: '拼贴艺术动画 · Nantian', engine: 'living-poster', description: '为当前镜头指定首帧和尾帧，逐件展开、连接并落到尾帧构图。可选下一镜头关键帧作为尾帧。', imagePrompt: 'Rich editorial paper-collage storyboard: one focal subject, supporting information objects, archival texture and foreground paper edge. Use historically appropriate props and an intentional visual anchor for the next scene.', motionPrompt: '首帧作为表演舞台，纸片、人物或路线按叙事因果逐件展开和连接，持续过渡到指定尾帧，末段保持尾帧构图；保留纸艺材质，不突然切镜。' },
] as const;

export function editorialRecipe(id?: EditorialRecipeId) { return EDITORIAL_RECIPES.find(recipe => recipe.id === id); }
