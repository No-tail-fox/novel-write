import type { PixelleTemplateDescriptor, PixelleTemplateParameter } from '../../shared/pixelle';

// Presentation only: never rename upstream files, parameter keys or default values.
const templateNames: Record<string, string> = {
  image_minimal_framed: '极简边框', asset_default: '通用图像与视频',
  image_blur_card: '模糊背景卡片', image_book: '书籍图文', image_cartoon: '卡通图文',
  image_default: '经典图文', image_elegant: '雅致图文', image_excerpt: '文字摘录',
  image_fashion_vintage: '复古时尚', image_full: '全幅图片', image_healing: '治愈图文',
  image_health_preservation: '养生知识', image_life_insights_light: '人生感悟 · 浅色',
  image_life_insights: '人生感悟 · 深色', image_long_text: '长文图文', image_modern: '现代图文',
  image_neon: '霓虹图文', image_psychology_card: '心理卡片', image_purple: '紫色图文',
  image_satirical_cartoon: '讽刺漫画', image_simple_black: '黑色极简', image_simple_line_drawing: '简约线稿',
  static_default: '经典纯文字', static_excerpt: '纯文字摘录', video_default: '经典视频',
  video_healing: '治愈视频', image_film: '电影图文', image_ultrawide_minimal: '超宽极简',
  image_wide_darktech: '暗色科技',
};
const parameterNames: Record<string, string> = {
  author: '作者', describe: '简介', brand: '品牌', subtitle: '副标题', signature: '署名',
  accent_color: '强调色', title_font_size: '标题字号', background: '背景图片地址',
};

export function pixelleTemplateLabel(template: Pick<PixelleTemplateDescriptor, 'ref' | 'name'>): string {
  const basename = template.ref.path.split('/').at(-1)?.replace(/\.html$/u, '') ?? '';
  return templateNames[basename] ?? template.name;
}

export function pixelleParameterLabel(key: string, parameter: PixelleTemplateParameter): string {
  return parameterNames[key] ?? (parameter.label || key);
}
