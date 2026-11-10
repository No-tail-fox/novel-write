import { STOCK_MEDIA_SECRET_IDS } from '../../shared/stock-media';
import { SecretInput, SettingsCard, type SecretEditor } from './settings-controls';

/** S-1: optional stock-media site keys; stored only in the encrypted credential vault like other provider keys. */
export function StockMediaKeyFields({ secrets }: { secrets: SecretEditor }) {
  const pexels = STOCK_MEDIA_SECRET_IDS.pexels;
  const pixabay = STOCK_MEDIA_SECRET_IDS.pixabay;
  const configured = [secrets.configured(pexels) ? 'Pexels' : '', secrets.configured(pixabay) ? 'Pixabay' : ''].filter(Boolean);
  return (
    <SettingsCard title="素材站密钥（短片在线素材）" status={configured.length ? `已配置 ${configured.join('、')}` : '未配置素材站密钥'}>
      <SecretInput label="Pexels API Key" value={secrets.value(pexels)} configured={secrets.configured(pexels)} onChange={(value) => secrets.change(pexels, value)} onClear={() => secrets.change(pexels, null)} />
      <SecretInput label="Pixabay API Key" value={secrets.value(pixabay)} configured={secrets.configured(pixabay)} onChange={(value) => secrets.change(pixabay, value)} onClear={() => secrets.change(pixabay, null)} />
    </SettingsCard>
  );
}
