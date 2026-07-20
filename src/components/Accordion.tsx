import { useId, useState, type ReactNode } from 'react';

export interface AccordionProps {
  title: string;
  open?: boolean;
  children: ReactNode;
  disabled?: boolean;
}

export function Accordion({ title, open = false, children, disabled = false }: AccordionProps) {
  const [expanded, setExpanded] = useState(open);
  const id = useId();
  const buttonId = `${id}-button`;
  const panelId = `${id}-panel`;
  return (
    <div className={expanded ? 'accordion open' : 'accordion'}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setExpanded(!expanded)}
      >
        › {title}
      </button>
      {expanded ? <div id={panelId} role="region" aria-labelledby={buttonId}>{children}</div> : null}
    </div>
  );
}
