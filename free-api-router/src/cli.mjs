import { loadCatalog, loadConfig } from './config.mjs';
import { syncCatalog } from './catalog.mjs';
import { checkProviders } from './health.mjs';
import { ProviderPool, resolveProviders } from './providers.mjs';

const command = process.argv[2] || 'sync';
const config = await loadConfig();

if (command === 'sync') {
  const catalog = await syncCatalog();
  console.log(`同步完成：${catalog.providers.length} 个可调用候选，${catalog.directory.length} 个公益目录入口。`);
  console.log(`数据源：${catalog.sources.map((source) => source.url).join(', ')}`);
} else if (command === 'check') {
  const catalog = await loadCatalog();
  if (!catalog) throw new Error('没有 catalog.json，请先运行 npm run sync');
  const providers = resolveProviders(config, catalog);
  if (providers.length === 0) {
    console.log('没有已配置且有 Key 的上游。请设置环境变量后再检查。');
    process.exitCode = 2;
  } else {
    const result = await checkProviders(new ProviderPool(providers, config.selection));
    for (const item of result.providers) {
      const label = item.ok ? 'OK  ' : 'DOWN';
      console.log(`${label} ${item.id.padEnd(28)} models=${item.modelsStatus ?? '-'} chat=${item.chatStatus ?? '-'} model=${item.model ?? '-'} ${item.latencyMs}ms`);
    }
    if (result.providers.some((item) => item.ok === false)) process.exitCode = 1;
  }
} else {
  throw new Error(`未知命令：${command}。可用命令：sync、check`);
}
