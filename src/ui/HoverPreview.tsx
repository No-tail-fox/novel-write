import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Portal } from '@fluentui/react-components';
import './preview-controls.css';

const ACTIVATED = 'storydream:hover-preview';
export interface HoverPreviewProps {
  children: ReactElement;
  title: string;
  description?: string;
  renderPreview: () => ReactNode;
  /** Controlled focus for listboxes whose keyboard focus stays on the trigger. */
  active?: boolean;
  disabled?: boolean;
}

/** Mount media only while a single, deliberately hovered/focused preview is open. */
export function HoverPreview({ children, title, description, renderPreview, active, disabled }: HoverPreviewProps) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, side: 'left' });
  const clearTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback(() => { clearTimer(); setOpen(false); }, [clearTimer]);
  const show = useCallback(() => {
    clearTimer();
    if (disabled) return;
    // Claim ownership when intent changes, so an older pending timer cannot
    // activate first and cancel a more recently hovered option.
    document.dispatchEvent(new CustomEvent(ACTIVATED, { detail: id }));
    timer.current = setTimeout(() => setOpen(true), 280);
  }, [clearTimer, disabled, id]);
  const leave = () => { clearTimer(); timer.current = setTimeout(() => setOpen(false), 90); };
  useEffect(() => { if (active) show(); else if (active === false || disabled) close(); }, [active, disabled, show, close]);
  useEffect(() => {
    const activated = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    document.addEventListener(ACTIVATED, activated);
    return () => { clearTimer(); document.removeEventListener(ACTIVATED, activated); };
  }, [id, close, clearTimer]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = anchor.current?.firstElementChild?.getBoundingClientRect(), panel = popup.current;
      if (!bounds || !panel) return;
      const margin = 10, gap = 10, width = panel.offsetWidth, height = panel.offsetHeight;
      const hasLeft = bounds.left - width - gap >= margin;
      const side = hasLeft ? 'left' : 'right';
      const proposed = hasLeft ? bounds.left - width - gap : bounds.right + gap;
      setPosition({ side, left: Math.max(margin, Math.min(proposed, innerWidth - width - margin)), top: Math.max(margin, Math.min(bounds.top, innerHeight - height - margin)) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', escape, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', close, true); document.removeEventListener('keydown', escape, true); };
  }, [open, close]);
  const trigger = children as ReactElement<{ 'aria-describedby'?: string }>;
  return <span className="sd-hover-preview-anchor" ref={anchor} onPointerEnter={show} onPointerLeave={leave} onFocus={active === undefined ? show : undefined} onBlur={close} onClickCapture={close}>
    {cloneElement(trigger, { 'aria-describedby': [trigger.props['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') || undefined })}
    {open ? <Portal><div ref={popup} id={id} role="tooltip" className="sd-hover-preview" data-preview-side={position.side} style={{ left: position.left, top: position.top }} onPointerEnter={clearTimer} onPointerLeave={leave}>
      <div className="sd-hover-preview-media">{renderPreview()}</div>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div></Portal> : null}
  </span>;
}
