export const directorPhases = [
  { id: 'script', label: '文案', entry: '剧本', stages: ['剧本'] },
  { id: 'storyboard', label: '分镜', entry: '镜头生成', stages: ['画面拆解', '素材一致性', '镜头生成'] },
  { id: 'audio', label: '声音', entry: '配音字幕', stages: ['配音字幕'] },
  { id: 'delivery', label: '交付', entry: '审片', stages: ['审片', '导出'] },
] as const;

export function directorPhaseForStage(stage: string) {
  return directorPhases.find((phase) => (phase.stages as readonly string[]).includes(stage)) ?? directorPhases[1];
}

export function directorPhaseComplete(phase: typeof directorPhases[number], completedStages: readonly string[]) {
  return phase.stages.every((stage) => completedStages.includes(stage));
}
