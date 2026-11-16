import { useState } from 'react';
import { ImageOff, Shirt, Pin } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { Button, TextAreaField, TextField } from '../../ui';
import { toLocalImageUrl } from '../tasks/task-formatters';
import './MotionComicCharacterProfile.css';

type Character = MotionComicPipelineData['characters'][number];
export type MotionComicCharacterProfilePatch = Partial<Pick<Character, 'name' | 'role' | 'aliases' | 'identityPrompt' | 'personality' | 'voiceNotes'>>;

/**
 * Character-level identity (shared by every look) shown as an always-open profile card.
 * The portrait is the real fixed reference of a look; nothing is invented when none exists.
 */
export function MotionComicCharacterProfile({ character, portraitPath, portraitLabel, fixedLooks, onChange, onManageReferences }: {
  character: Character;
  portraitPath?: string;
  portraitLabel?: string;
  fixedLooks: number;
  onChange: (patch: MotionComicCharacterProfilePatch) => void;
  onManageReferences?: () => void;
}) {
  const [failedPath, setFailedPath] = useState<string>();
  const showImage = Boolean(portraitPath) && failedPath !== portraitPath;
  return <section className="comic-character-profile" aria-label="人物档案">
    <figure className="comic-character-profile__portrait" data-empty={!showImage || undefined}>
      {showImage ? <img src={toLocalImageUrl(portraitPath!)} alt={`${character.name}参考图`} onError={() => setFailedPath(portraitPath)} /> : <span aria-hidden="true"><ImageOff size={26} /></span>}
      <figcaption>{showImage ? portraitLabel ?? '已固定参考' : portraitPath ? '参考图文件不可用' : '固定造型参考图后自动显示'}</figcaption>
      {onManageReferences ? <Button density="compact" variant="secondary" onClick={onManageReferences}>{showImage ? '管理造型参考图' : '上传或生成参考图'}</Button> : null}
    </figure>
    <div className="comic-character-profile__body">
      <header className="comic-character-profile__heading">
        <div>
          <strong>人物档案</strong>
          <small>所有造型共用；生成参考图和分镜时都会带上</small>
        </div>
        <div className="comic-character-profile__stats">
          <span><Shirt size={12} aria-hidden="true" />{character.looks.length} 个造型</span>
          <span data-tone={fixedLooks === character.looks.length && fixedLooks > 0 ? 'ok' : 'warn'}><Pin size={12} aria-hidden="true" />{fixedLooks}/{character.looks.length} 已固定</span>
        </div>
      </header>
      <div className="comic-character-profile__fields">
        <TextField label="人物名称" value={character.name} onChange={(_, data) => onChange({ name: data.value })} />
        <TextField label="戏剧作用" value={character.role} onChange={(_, data) => onChange({ role: data.value })} />
        <TextField label="人物别名" placeholder="多个别名用顿号分隔" value={(character.aliases ?? []).join('、')} onChange={(_, data) => onChange({ aliases: data.value.split(/[、,，\n]/).map((alias) => alias.trim()).filter(Boolean) })} />
        <div className="comic-character-profile__wide"><TextAreaField label="身份提示词" rows={3} value={character.identityPrompt} hint="年龄、性别、脸型、发色等跨造型不变的身份特征。" onChange={(_, data) => onChange({ identityPrompt: data.value })} resize="vertical" /></div>
        <div className="comic-character-profile__half"><TextAreaField label="性格与行为" rows={3} value={character.personality} onChange={(_, data) => onChange({ personality: data.value })} resize="vertical" /></div>
        <div className="comic-character-profile__half"><TextAreaField label="声音说明" rows={3} value={character.voiceNotes} onChange={(_, data) => onChange({ voiceNotes: data.value })} resize="vertical" /></div>
      </div>
    </div>
  </section>;
}
