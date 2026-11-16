import { useLayoutEffect, useRef, useState } from 'react';
import { AudioLines, Play, Upload } from 'lucide-react';
import { Button, Dialog } from '../../ui';
import './MotionComicCharacterVoiceSample.css';

export interface MotionComicCharacterVoiceSampleProps {
  characterName: string;
  sample?: { id: string; localPath?: string; durationMs?: number; label?: string };
  disabled?: boolean;
  onImport: () => Promise<void>;
  onUnlink: () => Promise<void>;
  getMediaUrl: (path: string) => Promise<string>;
}

export function formatVoiceSampleDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return '时长未知';
  return `${(durationMs / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 秒`;
}

/** Sample changes reset media and invalidate async work while keeping dialog focus management mounted. */
export function MotionComicCharacterVoiceSample(props: MotionComicCharacterVoiceSampleProps) {
  return <VoiceSamplePanel {...props} />;
}

function VoiceSamplePanel({ characterName, sample, disabled, onImport, onUnlink, getMediaUrl }: MotionComicCharacterVoiceSampleProps) {
  const [busy, setBusy] = useState<'import' | 'unlink' | 'play' | null>(null);
  const [error, setError] = useState('');
  const [playFailed, setPlayFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [url, setUrl] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const attempt = useRef(0);
  useLayoutEffect(() => {
    alive.current = true;
    locked.current = false;
    setBusy(null); setError(''); setPlayFailed(false); setConfirm(false); setUrl('');
    const player = audio.current;
    return () => {
      alive.current = false;
      attempt.current += 1;
      if (player) { player.pause(); player.currentTime = 0; player.removeAttribute('src'); player.load(); }
    };
  }, [characterName, sample?.id, sample?.localPath]);
  const fail = (reason: unknown, prefix: string) => {
    if (alive.current) setError(`${prefix}：${reason instanceof Error ? reason.message : String(reason)}。请重试。`);
  };
  const run = async (kind: 'import' | 'unlink', operation: () => Promise<void>) => {
    if (disabled || locked.current) return;
    locked.current = true; setBusy(kind); setError('');
    const token = ++attempt.current;
    const current = () => alive.current && attempt.current === token;
    try { await operation(); if (current() && kind === 'unlink') setConfirm(false); }
    catch (reason) { if (current()) fail(reason, kind === 'import' ? '导入失败' : '解绑失败'); }
    finally { if (current()) { locked.current = false; setBusy(null); } }
  };
  const preview = async () => {
    if (disabled || locked.current || !sample?.localPath) return;
    locked.current = true; setBusy('play'); setError(''); setPlayFailed(false);
    const token = ++attempt.current;
    const current = () => alive.current && attempt.current === token;
    try {
      const resolved = await getMediaUrl(sample.localPath);
      if (!current()) return;
      if (!resolved) throw new Error('未取得可播放的文件地址');
      const player = audio.current;
      if (!player) return;
      player.pause(); player.currentTime = 0;
      player.src = resolved;
      setUrl(resolved);
      await player.play();
    } catch (reason) {
      if (current()) { setPlayFailed(true); fail(reason, '试听失败'); }
    } finally {
      if (current()) { locked.current = false; setBusy(null); }
    }
  };
  const blocked = Boolean(disabled || busy);
  const fileName = sample?.label?.trim() || sample?.localPath?.split(/[\\/]/).pop() || '声音样本';
  return <section className="comic-voice-sample" aria-label={`${characterName}的声音样本`} aria-busy={Boolean(busy)}>
    <div className="comic-voice-sample__heading"><AudioLines size={20} aria-hidden="true" /><h3>角色声音样本</h3><span>仅保存与试听</span></div>
    <p className="comic-voice-sample__description">角色声音样本，用于保存与试听；当前视频与TTS不会自动采用。</p>
    <p className="comic-voice-sample__hint">与服务音色设置独立。支持 MP3 / WAV，最长 60 秒，最大 20MB。</p>
    <div className="comic-voice-sample__file">
      <div className="comic-voice-sample__metadata"><strong>{sample ? fileName : '尚未导入声音样本'}</strong><span>{sample ? `${formatVoiceSampleDuration(sample.durationMs)} · ${sample.localPath ? '已记录本地文件，点击试听检查' : '缺少本地文件，请替换样本'}` : '导入一段角色录音，随时回听。'}</span></div>
      <div className="comic-voice-sample__actions">
        <Button disabled={blocked} icon={<Upload size={16} aria-hidden="true" />} onClick={() => void run('import', onImport)}>{busy === 'import' ? '导入中…' : sample ? '替换样本' : '导入样本'}</Button>
        {sample && <><Button disabled={blocked || !sample.localPath} icon={<Play size={16} aria-hidden="true" />} onClick={() => void preview()}>{busy === 'play' ? '加载中…' : playFailed ? '重试试听' : '试听'}</Button><Button variant="subtle" disabled={blocked} onClick={() => { setError(''); setConfirm(true); }}>解绑</Button></>}
      </div>
    </div>
    <audio ref={audio} controls autoPlay preload="none" hidden={!url} aria-label={`${characterName}声音样本试听`} onError={() => { if (alive.current && audio.current?.getAttribute('src')) { setPlayFailed(true); setError('试听失败：文件不可读或格式不受支持。请重试试听，或替换样本。'); } }} />
    {error && !confirm && <p role="alert" className="comic-voice-sample__error">{error}</p>}
    <Dialog open={confirm} onOpenChange={(open) => { if (!locked.current) setConfirm(open); }} title="解绑声音样本？" actions={<><Button disabled={Boolean(busy)} onClick={() => setConfirm(false)}>取消</Button><Button variant="danger" disabled={blocked} onClick={() => void run('unlink', onUnlink)}>{busy === 'unlink' ? '解绑中…' : '确认解绑'}</Button></>}>
      <p>仅解除「{characterName}」与当前声音样本的关联，保留历史样本记录，不删除历史文件，不会改变服务音色设置。</p>
      {error && <p role="alert" className="comic-voice-sample__error">{error}</p>}
    </Dialog>
  </section>;
}
