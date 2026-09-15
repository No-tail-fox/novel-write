import { ExternalLink } from 'lucide-react';
import { Button } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import type { ProviderPortal } from '../../shared/provider-portals';

export function ProviderPortalLinks({ links, onOpen }: { links: ProviderPortal[]; onOpen: (url: string) => Promise<void> }) {
  return <PortalLinks key={links.map((link) => link.url).join('|')} links={links} onOpen={onOpen} />;
}

function PortalLinks({ links, onOpen }: { links: ProviderPortal[]; onOpen: (url: string) => Promise<void> }) {
  const action = useAsyncAction();
  return (
    <div className="provider-portal-links" role="group" aria-label="密钥与控制台">
      <strong>密钥与控制台</strong>
      {links.length ? (
        <div className="provider-portal-list">
          {links.map((link) => (
            <div className="provider-portal-item" key={link.url}>
              <Button variant="subtle" density="compact" icon={<ExternalLink size={14} aria-hidden="true" />} disabled={action.busy} title={link.url} onClick={() => void action.run(() => onOpen(link.url))}>
                {link.label}
              </Button>
              <span>{new URL(link.url).hostname}</span>
            </div>
          ))}
        </div>
      ) : <span className="provider-portal-empty">暂无可用的服务商网址</span>}
      <AsyncActionFeedback feedback={action.feedback} />
    </div>
  );
}
