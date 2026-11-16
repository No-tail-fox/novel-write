import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, ImageOff, Images, Plus, Search } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { toLocalImageUrl } from '../tasks/task-formatters';
import { fixedMotionComicReferenceAsset, motionComicReferenceAssets } from './motion-comic-consistency';
import './MotionComicAssetGallery.css';

export interface MotionComicAssetGalleryProps {
  document: MotionComicPipelineData;
  category: 'characters' | 'scenes' | 'props';
  query: string;
  onOpen: (id: string) => void;
  onAdd?: () => void;
}

interface GalleryItem {
  id: string;
  name: string;
  searchText: string;
  path?: string;
  referenceCount: number;
  lookCount?: number;
  missingLooks?: number;
  coverLabel?: string;
}

const categoryLabels = { characters: '人物', scenes: '场景', props: '道具' };

function galleryItems(document: MotionComicPipelineData, category: MotionComicAssetGalleryProps['category']): GalleryItem[] {
  if (category === 'characters') return document.characters.map((character) => {
    const looks = character.looks.map((look) => ({ look, fixed: fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds) }));
    const cover = looks.find(({ look, fixed }) => look.pinned && fixed) ?? looks.find(({ fixed }) => fixed);
    return {
      id: character.id,
      name: character.name || '未命名人物',
      searchText: [character.name, ...(character.aliases ?? []), ...character.looks.map((look) => look.label)].join(' '),
      path: cover?.fixed?.localPath,
      referenceCount: motionComicReferenceAssets(document, character.looks.flatMap((look) => look.referenceAssetVersionIds)).length,
      lookCount: character.looks.length,
      missingLooks: looks.filter(({ fixed }) => !fixed).length,
      coverLabel: cover?.look.label,
    };
  });
  return (category === 'scenes' ? document.sceneAssets : document.props).map((asset) => ({
    id: asset.id,
    name: asset.label || `未命名${categoryLabels[category]}`,
    searchText: asset.label,
    path: fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds)?.localPath,
    referenceCount: motionComicReferenceAssets(document, asset.referenceAssetVersionIds).length,
  }));
}

function AssetCard({ item, category, onOpen }: { item: GalleryItem; category: MotionComicAssetGalleryProps['category']; onOpen: (id: string) => void }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(item.path) && !failed;
  const status = failed ? '固定图加载失败' : !item.path ? '缺少固定图' : item.missingLooks ? `${item.missingLooks} 个造型缺固定图` : '已固定参考';
  const ready = hasImage && !item.missingLooks;
  const tone = failed ? 'danger' : ready ? 'ok' : item.path ? 'warn' : 'neutral';
  return <li className="comic-gallery-item">
    <button type="button" className="comic-gallery-card" data-category={category} onClick={() => onOpen(item.id)} aria-label={`打开${item.name}详情`}>
      <span className="comic-gallery-preview">
        {hasImage ? <img src={toLocalImageUrl(item.path!)} alt={`${item.name}${item.coverLabel ? ` · ${item.coverLabel}` : ''}固定参考图`} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="comic-gallery-placeholder">
          <ImageOff size={28} aria-hidden="true" />
          <strong>{failed ? '参考图加载失败' : '待添加参考'}</strong>
          <small>{failed ? '打开详情检查或重新导入' : '打开详情添加参考'}</small>
        </span>}
      </span>
      <span className="comic-gallery-body">
        <span className="comic-gallery-name"><strong>{item.name}</strong><span className="comic-gallery-chip" data-tone={tone}>{ready ? <CheckCircle2 size={12} aria-hidden="true" /> : null}{status}</span></span>
        <span className="comic-gallery-looks">{item.lookCount !== undefined ? `${item.lookCount} 个造型 · ` : ''}{item.referenceCount} 张参考{item.coverLabel ? ` · ${item.coverLabel}` : ''}</span>
        <span className="comic-gallery-meta"><span>{categoryLabels[category]} · 跨集共用</span><span className="comic-gallery-open">{category === 'characters' ? '角色详情' : '查看设定'}<ArrowUpRight size={14} aria-hidden="true" /></span></span>
      </span>
    </button>
  </li>;
}

/** Read-only overview: all edits and reference actions remain in the existing detail editor. */
export function MotionComicAssetGallery({ document, category, query, onOpen, onAdd }: MotionComicAssetGalleryProps) {
  const items = galleryItems(document, category);
  const needle = query.trim().toLocaleLowerCase();
  const visible = items.filter((item) => !needle || item.searchText.toLocaleLowerCase().includes(needle));
  const label = categoryLabels[category];
  if (!visible.length) return <div className="comic-asset-gallery comic-gallery-empty">
    {items.length ? <Search size={30} aria-hidden="true" /> : <Images size={30} aria-hidden="true" />}
    <strong role="status">{items.length ? `没有匹配的${label}` : `暂无${label}资产`}</strong>
    <p>{items.length ? `未找到与“${query.trim()}”匹配的${label}，请尝试其他名称或清空搜索。` : `新增${label}后，可在详情中编辑定义、导入参考或生成候选图。`}</p>
    {!items.length && onAdd ? <button type="button" className="comic-gallery-add" onClick={onAdd}><Plus size={16} aria-hidden="true" />新增{label}</button> : null}
  </div>;
  return <div className="comic-asset-gallery">
    <ul className="comic-gallery-grid" aria-label={`${label}资产`}>
      {visible.map((item) => <AssetCard key={`${category}:${item.id}:${item.path ?? ''}`} item={item} category={category} onOpen={onOpen} />)}
      {onAdd && !needle ? <li className="comic-gallery-item"><button type="button" className="comic-gallery-add-card" onClick={onAdd}>
        <Plus size={24} aria-hidden="true" /><strong>新增一个{label}</strong><small>先定义名称与设定，再在详情中补充参考</small>
      </button></li> : null}
    </ul>
  </div>;
}
