import type { ReactNode } from 'react';
import './creation-page.css';

export interface CreationPageHeaderProps {
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function CreationPageHeader({ title, description, icon, actions }: CreationPageHeaderProps) {
  return (
    <header className="creation-page-header">
      <div className="creation-page-heading">
        {icon ? <span className="creation-page-header-icon" aria-hidden="true">{icon}</span> : null}
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      {actions ? <div className="creation-page-header-actions">{actions}</div> : null}
    </header>
  );
}
