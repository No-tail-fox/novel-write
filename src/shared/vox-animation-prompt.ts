import { voxTemplate, type VoxGenerateRequest } from './vox-animation';
import { shotcraftRecipe } from './shotcraft-recipes';
export function voxAnimationMessages(input:VoxGenerateRequest) {
  return [
    {role:'system' as const,content:'你是 Remotion 动画开发者。只输出完整 TSX 源码，不要 Markdown。使用 import React from "react"; 以及从 "remotion" 导入 AbsoluteFill、Img、useCurrentFrame、useVideoConfig、interpolate、spring。必须 export default 一个 React 函数组件。只允许 react/remotion 依赖；不可访问 window/document/globalThis/parent/process/navigator/fetch/require/eval、网络、定时器、随机数或存储。所有运动由 useCurrentFrame 驱动，必须适配实际 useVideoConfig 的 width/height/durationInFrames。组件 props 包含 title/subtitle/author/source/accent/background/foreground/unit/highlight/items/assetIds，以及 assets:[{id,kind,url}] 和 cues:[{text,startMs,endMs,tokens?}]。仅使用传入的 assets 中 URL，不伪造链接。不要调用 registerRoot 或 Composition。旁白和字幕由宿主负责，不放 Audio 或 Video。画面底部保留 16% 字幕空间。中文长标题需要自动换行；不使用虚假事实或示例数据填空。'},
    {role:'user' as const,content:JSON.stringify({request:input.prompt,outputContract:'输出精简且完整的可执行 TSX，建议不超过 180 行；不要长注释、大段静态纹理路径或重复类型声明。优先完成组件和闭合标签，避免输出被截断。静态 CSS 属性 top 可正常使用，但不可读取全局 top 或 window。所有标题、来源和图注必须完整位于画面上部 82% 内。文字在最终画布上的字号至少为短边 / 45（1080p 至少 24px），来源、单位、坐标刻度同样适用；主标题至少短边 / 20。背景、正文、强调色分别使用 props.background、props.foreground、props.accent，遵守所选风格，不自行换成深色或浅色主题。只使用已提供的事实，不自行添加历史最高、警戒线、基准期或其他未经提供的断言。',referenceTemplate:voxTemplate(input.templateId)?.name,shotRecipe:shotcraftRecipe(input.templateId),props:input.props,durationMs:input.durationMs,ratio:input.ratio,currentCode:input.source||undefined})},
  ];
}
