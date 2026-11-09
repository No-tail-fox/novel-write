import type { VoxAnimation } from '../vox-animation';
import type { VoxProductionSettings } from '../vox-production';
import { creativeStyle, resolveCreativeStyle } from './styles';

/** Describe the saved renderer, never infer applied style from the current selector. */
export function creativeStyleStatus(animation?: VoxAnimation, settings?: VoxProductionSettings): string {
  const chosen=settings?resolveCreativeStyle(settings.authoring?.styleId,settings.presetId):undefined;
  const custom=animation?.mode==='code';
  const actualId=custom?animation.authoring?.styleId:animation?.creativeStyle?.styleId;
  const actual=actualId?creativeStyle(actualId):undefined;
  const technique=animation?.code.engine==='lemo-native'?'Lemo 原生全片':custom?'AI 风格代码':animation?.creativeStyle?.source==='local'?'本地风格编排':animation?.authoring?.status==='fallback'?'同风格保底':'风格编排';
  const state=animation?.code.engine==='lemo-native'&&animation.authoring?.status!=='reviewed'?(animation?.authoring?.status==='needs-repair'?'需修复':'待检查'):'已应用';
  const result=actual?`${state}：${actual.cn} · ${technique}`:custom?'手动自定义代码':animation?'旧版镜头，待应用风格':'尚未装配动画';
  if (chosen && settings?.authoring?.mode === 'ai-code' && (animation?.code.engine !== 'lemo-native' || chosen.slug !== actualId)) return `${result} · 待创作：${chosen.cn} · Lemo 原生全片`;
  return chosen&&chosen.slug!==actualId?`${result} · 待应用：${chosen.cn}`:result;
}