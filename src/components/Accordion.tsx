import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui';

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
      <Button
        id={buttonId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggleExpanded}
        variant="subtle"
        icon={expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      >
        {title}
      </Button>
      {expanded ? <div id={panelId} role="region" aria-labelledby={buttonId}>{children}</div> : null}
    </div>
  );
}
