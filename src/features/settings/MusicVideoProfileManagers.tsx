import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Play, Plus, Trash2 } from 'lucide-react';
import type { AppConfig, MusicProviderProfile, VisionProviderProfile } from '../../shared/types';
import {
  activeMusicProfileId, activeVideoProfileId, addMusicProfile, addVideoProfile,
  copyMusicProfile, copyVideoProfile, getMusicProfile, normalizedMusicProfiles,
  normalizedVideoProfiles, removeMusicProfile, removeVideoProfile,
  activeSpeechToTextProfileId, activeVisionProfileId, addSpeechToTextProfile, addVisionProfile,
  copySpeechToTextProfile, copyVisionProfile, getVisionProfile, normalizedSpeechToTextProfiles,
  normalizedVisionProfiles, removeSpeechToTextProfile, removeVisionProfile,
} from '../../shared/provider-profile-utils';
import { Button, CheckboxField, Dialog, IconButton, SelectField, TextAreaField, TextField } from '../../ui';
import { resolveLlmProtocol } from '../../shared/llm-protocol';
import { profileSecretId, type SecretEditor } from './settings-controls';
import './music-video-profiles.css';

type ProfileManagerProps = {
  config: AppConfig;
  selectedProfileId: string;
  saving: boolean;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
};

export function ProfileSecretField({ profileId, domain, secrets }: {
  profileId: string; domain: 'music' | 'video' | 'speechToText' | 'viralVision'; secrets: SecretEditor;
}) {
  const [revealed, setRevealed] = useState(false);
  const id = profileSecretId(domain, profileId, 'apiKey');
  const configured = secrets.configured(id);
  useEffect(() => setRevealed(false), [profileId]);
  return <TextField
    fieldClassName="media-profile-secret"
    label="API Key"
    type={revealed ? 'text' : 'password'}
    value={secrets.value(id)}
    autoComplete="new-password"
    spellCheck={false}
    placeholder={configured ? '已保存密钥；输入新值可替换' : '输入此配置的 API Key'}
    hint={configured ? '已配置。保存的密钥不会在界面中回显。' : '密钥加密保存于本机。'}
    onChange={(_, data) => secrets.change(id, data.value)}
    contentAfter={<>
      <IconButton variant="subtle" label={revealed ? '隐藏新密钥' : '显示新密钥'} icon={revealed ? <EyeOff size={15} /> : <Eye size={15} />} onClick={() => setRevealed((current) => !current)} />
      <IconButton variant="subtle" label="清除此配置密钥" icon={<Trash2 size={15} />} disabled={!configured && !secrets.value(id)} onClick={() => secrets.change(id, null)} />
    </>}
  />;
}

function ProfileSwitcher({ profiles, activeId, selectedId, saving, label, enabled = true, onSelect, onActivate, onAdd, onCopy, onRemove }: {
  profiles: { id: string; name: string; model: string; baseUrl: string }[];
  activeId: string; selectedId: string; saving: boolean; label: string; enabled?: boolean;
  onSelect: (id: string) => void; onActivate: (id: string) => Promise<void>;
  onAdd: () => void; onCopy: () => void; onRemove: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedId);
  const isActive = selectedId === activeId;
  return <div className="media-profile-switcher">
    <div className="media-profile-heading">
      <div><strong>{label}配置</strong><span>可保存多个模型配置，选中用于编辑，启用用于创作。复制配置后需单独设置密钥。</span></div>
      <Button icon={<Plus size={15} />} disabled={saving} onClick={onAdd}>新增配置</Button>
    </div>
    <div className="media-profile-list" aria-label={`${label}配置列表`}>
      {profiles.map((profile) => <Button key={profile.id} variant="subtle"
        className="media-profile-row" aria-pressed={profile.id === selectedId}
        disabled={saving} onClick={() => onSelect(profile.id)}>
        <span className="media-profile-row-name">{profile.name || '未命名配置'}{profile.id === activeId ? <small>{enabled ? '启用中' : '当前配置 · 服务关闭'}</small> : null}</span>
        <span className="media-profile-row-detail">{profile.model || '未填写模型'} · {profile.baseUrl || '未填写接口地址'}</span>
      </Button>)}
    </div>
    <div className="media-profile-toolbar">
      <span>正在编辑：<strong>{selected?.name || '未命名配置'}</strong></span>
      <div>
        <Button density="compact" icon={<Copy size={14} />} disabled={saving} onClick={onCopy}>复制配置</Button>
        <Button density="compact" icon={<Trash2 size={14} />} disabled={saving || profiles.length <= 1 || isActive} title={isActive ? '请先启用另一配置，再删除此配置' : undefined} onClick={() => setDeleting(true)}>删除配置</Button>
        <Button density="compact" variant="primary" icon={<Play size={14} />} disabled={saving || (isActive && enabled)} onClick={() => void onActivate(selectedId)}>{isActive && enabled ? '已启用' : '启用此配置'}</Button>
      </div>
    </div>
    <Dialog open={deleting} title={`删除「${selected?.name || '未命名配置'}」？`} onOpenChange={setDeleting}
      actions={<><Button onClick={() => setDeleting(false)}>取消</Button><Button variant="danger" onClick={() => { onRemove(); setDeleting(false); }}>删除配置</Button></>}>
      删除后需点击“保存配置”才会生效。
    </Dialog>
  </div>;
}

function newProfileId(before: { id: string }[], after: { id: string }[]) {
  return after.find((profile) => !before.some((previous) => previous.id === profile.id))?.id;
}

export function MusicProfileManager({ config, selectedProfileId, saving, secrets, onChange, onSelectedProfileIdChange, onActivate }: ProfileManagerProps & { secrets: SecretEditor }) {
  const profiles = normalizedMusicProfiles(config);
  const activeId = activeMusicProfileId(config);
  const selected = config.music.profiles.find((profile) => profile.id === selectedProfileId) ?? getMusicProfile(config, selectedProfileId);
  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) onSelectedProfileIdChange(activeId);
  }, [activeId, onSelectedProfileIdChange, profiles, selectedProfileId]);
  const defaultOrigin = selected.baseUrl.trim().replace(/\/+$/, '') === 'https://www.suno-api.io';
  function update(patch: Partial<MusicProviderProfile>) {
    onChange({ ...config, music: { ...config.music, profiles: config.music.profiles.map((profile) => profile.id === selected.id ? { ...profile, ...patch } : profile) } });
  }
  function changeProfiles(next: AppConfig) {
    onChange(next);
    onSelectedProfileIdChange(newProfileId(profiles, normalizedMusicProfiles(next)) ?? activeMusicProfileId(next));
  }
  return <div className="media-profile-manager">
    <CheckboxField label="开启音乐创作服务" checked={config.music.enabled} onChange={(_, data) => onChange({ ...config, music: { ...config.music, enabled: Boolean(data.checked) } })} />
    <ProfileSwitcher profiles={profiles} label="音乐" activeId={activeId} selectedId={selected.id} saving={saving} enabled={config.music.enabled}
      onSelect={onSelectedProfileIdChange} onActivate={onActivate}
      onAdd={() => changeProfiles(addMusicProfile(config))}
      onCopy={() => changeProfiles(copyMusicProfile(config, selected.id))}
      onRemove={() => changeProfiles(removeMusicProfile(config, selected.id))} />
    <div className="media-profile-editor">
      <TextField label="配置名称" value={selected.name} onChange={(_, data) => update({ name: data.value })} />
      <SelectField label="默认音乐模型" value={selected.model} options={[
        { value: 'suno-v6', label: 'Suno V6' }, { value: 'suno-v6-wild', label: 'Suno V6 Wild' }, { value: 'suno-v6-mini', label: 'Suno V6 Mini' },
      ]} onChange={(event) => update({ model: event.target.value as MusicProviderProfile['model'] })} hint="进入音乐创作时默认使用此模型，创作时仍可切换。" />
      <TextField fieldClassName="media-profile-wide" label="音乐 API 地址" value={selected.baseUrl}
        onChange={(_, data) => update({ baseUrl: data.value, useEnvironmentKey: data.value.trim().replace(/\/+$/, '') === 'https://www.suno-api.io' && selected.useEnvironmentKey })}
        hint="填写 HTTPS 站点根地址。目前支持 Suno-API 兼容协议。" />
      <div className="media-profile-wide media-profile-key-source">
        <CheckboxField label="使用已登记的系统 Suno 密钥" checked={selected.useEnvironmentKey} disabled={!defaultOrigin}
          onChange={(_, data) => update({ useEnvironmentKey: Boolean(data.checked) })} />
        <p>{defaultOrigin ? '开启后使用本机已登记的 Suno 密钥，无需重复填写。' : '新地址需要单独填写密钥；系统 Suno 密钥仅用于已登记站点。'}</p>
      </div>
      {!selected.useEnvironmentKey ? <div className="media-profile-wide"><ProfileSecretField domain="music" profileId={selected.id} secrets={secrets} /></div> : null}
    </div>
    <p className="media-profile-footnote">保存配置会保留当前启用项；“保存并测试”只查询所选配置的余额，不生成音乐。</p>
  </div>;
}

export function VideoProfileSwitcher({ config, selectedProfileId, saving, onChange, onSelectedProfileIdChange, onActivate }: ProfileManagerProps) {
  const profiles = normalizedVideoProfiles(config);
  const activeId = activeVideoProfileId(config);
  const selected = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) onSelectedProfileIdChange(activeId);
  }, [activeId, onSelectedProfileIdChange, profiles, selectedProfileId]);
  function changeProfiles(next: AppConfig) {
    onChange(next);
    onSelectedProfileIdChange(newProfileId(profiles, normalizedVideoProfiles(next)) ?? activeVideoProfileId(next));
  }
  return <ProfileSwitcher profiles={profiles} label="视频" activeId={activeId} selectedId={selected.id} saving={saving} enabled={profiles.find((profile) => profile.id === activeId)?.enabled}
    onSelect={onSelectedProfileIdChange} onActivate={onActivate}
    onAdd={() => changeProfiles(addVideoProfile(config))}
    onCopy={() => changeProfiles(copyVideoProfile(config, selected.id))}
    onRemove={() => changeProfiles(removeVideoProfile(config, selected.id))} />;
}

export function TranscriptionVisionProfileSwitcher({ domain, config, selectedProfileId, saving, onChange, onSelectedProfileIdChange, onActivate }: ProfileManagerProps & { domain: 'speechToText' | 'vision' }) {
  const profiles = domain === 'vision' ? normalizedVisionProfiles(config) : normalizedSpeechToTextProfiles(config);
  const activeId = domain === 'vision' ? activeVisionProfileId(config) : activeSpeechToTextProfileId(config);
  const selected = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) onSelectedProfileIdChange(activeId);
  }, [activeId, onSelectedProfileIdChange, profiles, selectedProfileId]);
  function changeProfiles(next: AppConfig) {
    onChange(next);
    const nextProfiles = domain === 'vision' ? normalizedVisionProfiles(next) : normalizedSpeechToTextProfiles(next);
    onSelectedProfileIdChange(newProfileId(profiles, nextProfiles) ?? activeId);
  }
  return <ProfileSwitcher profiles={profiles} label={domain === 'vision' ? '视觉分析' : '语音转文字'} activeId={activeId} selectedId={selected.id} saving={saving}
    onSelect={onSelectedProfileIdChange} onActivate={onActivate}
    onAdd={() => changeProfiles(domain === 'vision' ? addVisionProfile(config) : addSpeechToTextProfile(config))}
    onCopy={() => changeProfiles(domain === 'vision' ? copyVisionProfile(config, selected.id) : copySpeechToTextProfile(config, selected.id))}
    onRemove={() => changeProfiles(domain === 'vision' ? removeVisionProfile(config, selected.id) : removeSpeechToTextProfile(config, selected.id))} />;
}

export function VisionProfileManager(props: ProfileManagerProps & { secrets: SecretEditor }) {
  const { config, selectedProfileId, secrets, onChange } = props;
  const selected = config.viral.visionProfiles.find((profile) => profile.id === selectedProfileId) ?? getVisionProfile(config, selectedProfileId);
  function update(patch: Partial<VisionProviderProfile>) {
    onChange({ ...config, viral: { ...config.viral, visionProfiles: config.viral.visionProfiles.map((profile) => profile.id === selected.id ? { ...profile, ...patch } : profile) } });
  }
  return <div className="media-profile-manager">
    <TranscriptionVisionProfileSwitcher {...props} domain="vision" />
    <div className="media-profile-editor">
      <TextField label="配置名称" value={selected.name} onChange={(_, data) => update({ name: data.value })} />
      <SelectField label="视觉模型协议" value={resolveLlmProtocol(selected)} options={[
        { value: 'openai', label: 'OpenAI Chat Completions' }, { value: 'responses', label: 'OpenAI Responses' }, { value: 'anthropic', label: 'Anthropic Messages' },
      ]} onChange={(event) => update({ protocol: event.target.value as VisionProviderProfile['protocol'], provider: event.target.value === 'anthropic' ? 'anthropic' : 'custom' })} />
      <TextField fieldClassName="media-profile-wide" label="视觉分析 API 地址" value={selected.baseUrl} onChange={(_, data) => update({ baseUrl: data.value })} />
      <div className="media-profile-wide"><ProfileSecretField domain="viralVision" profileId={selected.id} secrets={secrets} /></div>
      <TextField label="视觉模型" value={selected.model} onChange={(_, data) => update({ model: data.value })} hint="用于分析视频关键帧；选择支持图片输入的模型。" />
      <TextField label="请求超时（秒）" type="number" min={10} step={10} value={String(Math.round((selected.timeoutMs || 120000) / 1000))} onChange={(_, data) => update({ timeoutMs: Number(data.value) * 1000 })} />
      <TextField fieldClassName="media-profile-wide" label="代理地址（选填）" value={selected.proxyUrl} onChange={(_, data) => update({ proxyUrl: data.value })} />
      <TextAreaField fieldClassName="media-profile-wide" label="附加请求参数（JSON）" value={selected.requestParamsJson || '{}'} onChange={(_, data) => update({ requestParamsJson: data.value })} />
    </div>
  </div>;
}
