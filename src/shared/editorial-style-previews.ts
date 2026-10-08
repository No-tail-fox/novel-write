export interface EditorialStylePreview {
  src: string;
  description: string;
}

const previews: Record<string, EditorialStylePreview> = {
  'archival-red': {
    src: new URL('../assets/vox-style-previews/archival-red.webp', import.meta.url).href,
    description: '黑白档案照片、粗粝纸张与红色重点。适合历史、调查与观点解说。',
  },
  'swiss-signal': {
    src: new URL('../assets/vox-style-previews/swiss-signal.webp', import.meta.url).href,
    description: '清晰网格、几何色块与高反差照片。适合科技、数据与现代议题。',
  },
  'museum-paper': {
    src: new URL('../assets/vox-style-previews/museum-paper.webp', import.meta.url).href,
    description: '暖色纸本、低饱和照片与轻柔层次。适合文化、人物与知识讲述。',
  },
};

/** Bundled AI-generated references. Hovering never creates a model request. */
export function editorialStylePreview(id: string): EditorialStylePreview | undefined {
  return Object.hasOwn(previews, id) ? previews[id] : undefined;
}

export function editorialStylePreviewUrl(id: string): string | undefined {
  return editorialStylePreview(id)?.src;
}
