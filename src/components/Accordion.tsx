import { useId, useState, type ReactNode } from 'react';

export interface AccordionProps {
  title: string;
  open?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}

export function Accordion({ title, open = false, expanded: controlledExpanded, onExpandedChange, children, disabled = false }: AccordionProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(open);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const id = useId();
  const buttonId = `${id}-button`;
  const panelId = `${id}-panel`;

  function toggleExpanded() {
    const nextExpanded = !expanded;
    if (controlledExpanded === undefined) setUncontrolledExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  }

  return (
    <div className={expanded ? 'accordion open' : 'accordion'}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggleExpanded}
      >
        › {title}
      </button>
      {expanded ? <div id={panelId} role="region" aria-labelledby={buttonId}>{children}</div> : null}
    </div>
  );
}
