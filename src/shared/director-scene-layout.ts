export function directorSceneLayoutClass(layoutTemplate?: string): string {
  return layoutTemplate === '纪录片 · 纯画面' ? 'documentary' : layoutTemplate === '漫画分格 · 角色优先' ? 'comic' : 'collage';
}

export function directorSceneSubtitleClass(subtitleStyle?: string): string {
  return subtitleStyle === '简体中文 · 下方黑底' ? 'backplate' : 'outline';
}
