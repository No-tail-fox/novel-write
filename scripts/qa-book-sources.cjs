// Isolated renderer/IPC regression host. Replays captured public book results;
// favorites and other storage operations still use the production handlers.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated book QA directory');
const root = join(__dirname, '..');
const fixtures = JSON.parse(readFileSync(join(root, '.artifacts/book-sources/live-results.json'), 'utf8'));
const ledger = { searches: [], blockedGeneration: 0 };
const save = () => writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const flags = () => { try { return JSON.parse(readFileSync(join(directory, 'controls.json'), 'utf8')); } catch { return {}; } };
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (/generate|render|task:create-and-run/.test(channel)) {
    ledger.blockedGeneration += 1; save();
    throw new Error('Book QA disallows generation');
  }
  if (channel !== 'book-selection:discover') return listener(event, ...args);
  const request = args[0];
  const control = flags();
  ledger.searches.push(request); save();
  await new Promise(resolve => setTimeout(resolve, 450));
  const fixture = structuredClone(fixtures.find(item => item.query === request.query) ?? fixtures[0]);
  const selected = request.sources ?? ['dangdang', 'weread', 'douban'];
  fixture.query = request.query;
  fixture.track = request.track;
  fixture.items = fixture.items.filter(item => selected.includes(item.source) && item.source !== control.failSource);
  fixture.sources = fixture.sources.filter(item => selected.includes(item.source)).map(item => item.source === control.failSource
    ? { ...item, status: 'failed', count: 0, message: 'QA simulated source outage' } : item);
  if (control.empty || control.failed) {
    fixture.items = [];
    fixture.sources = fixture.sources.map(item => ({ ...item, status: control.failed ? 'failed' : 'empty', count: 0 }));
    fixture.sourceState = control.failed ? 'failed' : 'empty';
    fixture.sourceLabel = control.failed ? '来源暂不可用' : '未找到书目';
  }
  fixture.message = `已整理 ${fixture.items.length} 条书目。`;
  return { ok: true, value: fixture };
});
app.setPath('userData', directory);
app.setAppPath(root);
app.setName('storydream');
save();
require(join(root, require('../package.json').main));
