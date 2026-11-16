import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../../ui';
import type { MotionComicFrameImportPhase } from './motion-comic-frame-import';
import './motion-comic-frame-interactions.css';

export const MOTION_COMIC_FRAME_MIME = 'application/x-storydream-frame';

export interface MotionComicFrameOption { id: string; label: string; url: string }
type Slot = 'first' | 'last';

/** First/last frame slots with drag-in, click-to-set and previous-shot reuse. Writes go through callbacks only. */
export function MotionComicFramePanel({ firstId, lastId, previousId, options, busy, onSetFirst, onSetLast, onUsePrevious, onImport }: {
  firstId?: string;
  lastId?: string;
  previousId?: string;
  options: readonly MotionComicFrameOption[];
  busy: boolean;
  onSetFirst: (assetId: string | undefined) => void;
  onSetLast: (assetId: string | undefined) => void;
  onUsePrevious: () => void;
  onImport?: (slot: Slot, signal: AbortSignal, onPhase: (phase: MotionComicFrameImportPhase) => void) => Promise<unknown>;
}) {
  const [over, setOver] = useState<Slot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ slot: Slot; phase: MotionComicFrameImportPhase } | null>(null);
  const importRef = useRef<{ controller: AbortController; phase: MotionComicFrameImportPhase } | null>(null);
  useEffect(() => () => { importRef.current?.controller.abort(); importRef.current = null; }, []);
  const locked = busy || pending !== null;
  async function importFrame(slot: Slot) {
    if (!onImport || locked || importRef.current) return;
    const request = { controller: new AbortController(), phase: 'importing' as MotionComicFrameImportPhase };
    importRef.current = request;
    setError('');
    setPending({ slot, phase: 'importing' });
    try {
      await onImport(slot, request.controller.signal, phase => {
        request.phase = phase;
        if (importRef.current === request) setPending({ slot, phase });
      });
    } catch (reason) {
      if (importRef.current === request && !request.controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (importRef.current === request) { importRef.current = null; setPending(null); }
    }
  }
  function cancelImport() {
    if (importRef.current?.phase !== 'importing') return;
    importRef.current.controller.abort();
    importRef.current = null;
    setPending(null);
  }
  const byId = new Map(options.map((option) => [option.id, option]));
  const previous = previousId ? byId.get(previousId) : undefined;
  function run(action: () => void) {
    try { action(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const assign = (slot: Slot, id: string | undefined) => run(() => (slot === 'first' ? onSetFirst(id) : onSetLast(id)));
  function drop(slot: Slot, event: DragEvent) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData(MOTION_COMIC_FRAME_MIME);
    if (!locked && id) assign(slot, id);
  }
  function dragStart(event: DragEvent, id: string) {
    event.dataTransfer.setData(MOTION_COMIC_FRAME_MIME, id);
    event.dataTransfer.effectAllowed = 'copy';
  }
  const renderSlot = (slot: Slot, title: string, id: string | undefined) => {
    const asset = id ? byId.get(id) : undefined;
    return <figure className='comic-frame-slot' data-over={over === slot} data-empty={!asset}
      onDragOver={(event) => { if (locked || !event.dataTransfer.types.includes(MOTION_COMIC_FRAME_MIME)) return; event.preventDefault(); setOver(slot); }}
      onDragLeave={() => setOver(null)}
      onDrop={(event) => drop(slot, event)}>
      {asset ? <img src={asset.url} alt={`${title}预览`} draggable={false} /> : <span className='comic-frame-slot__empty'>{id ? `${title}已设置` : `拖入图片作为${title}`}</span>}
      <figcaption><strong>{title}</strong>{id ? <Button density='compact' variant='subtle' disabled={locked} aria-label={`清除${title}`} onClick={() => assign(slot, undefined)}>清除</Button> : null}</figcaption>
      {onImport ? <div className='comic-frame-slot__import'>
        <Button density='compact' variant='secondary' icon={<Upload size={14} />} disabled={locked} aria-label={`${id ? '替换' : '上传'}${title}图片`} onClick={() => void importFrame(slot)}>{id ? '替换图片' : '上传图片'}</Button>
        {pending?.slot === slot ? <>
          <span role='status'>{pending.phase === 'saving' ? '正在保存…' : '正在导入…'}</span>
          <Button density='compact' variant='subtle' disabled={pending.phase === 'saving'} aria-label={`取消${title}导入`} onClick={cancelImport}>取消</Button>
        </> : null}
      </div> : null}
    </figure>;
  };
  return <section className='comic-frame-panel' aria-label='首尾帧'>
    <div className='comic-frame-panel__slots'>
      {renderSlot('first', '首帧', firstId)}
      <span className='comic-frame-panel__arrow' aria-hidden='true'>→</span>
      {renderSlot('last', '尾帧', lastId)}
    </div>
    <div className='comic-frame-panel__previous'>
      {previous ? <img src={previous.url} alt='上一镜头画面' draggable onDragStart={(event) => dragStart(event, previous.id)} /> : null}
      <Button density='compact' variant='secondary' disabled={locked || !previousId} title={previousId ? '把上一镜头的尾帧（没有则用首帧）设为本镜头首帧，也可以直接拖入槽位' : '上一镜头还没有可用画面'} onClick={() => run(onUsePrevious)}>使用上一镜头画面作首帧</Button>
    </div>
    {options.length ? <ul className='comic-frame-strip' aria-label='可用画面，可拖入首帧或尾帧'>
      {options.map((option) => <li key={option.id}>
        <img src={option.url} alt={option.label} title={option.label} draggable={!locked} onDragStart={(event) => dragStart(event, option.id)} loading='lazy' />
        <span><Button density='compact' variant='subtle' disabled={locked || option.id === firstId} onClick={() => assign('first', option.id)}>设为首帧</Button><Button density='compact' variant='subtle' disabled={locked || option.id === lastId} onClick={() => assign('last', option.id)}>设为尾帧</Button></span>
      </li>)}
    </ul> : <p className='comic-frame-panel__hint'>{onImport ? '需要指定画面时，可上传本地图片或生成分镜图。' : '暂无可选图片，可在制作工作台按需生成分镜图。'}</p>}
    {error ? <p className='comic-frame-panel__error' role='alert'>{error}</p> : null}
  </section>;
}
