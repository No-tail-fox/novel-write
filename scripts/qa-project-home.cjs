// Fault injection stays in an isolated QA host around the production IPC handlers.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated project QA directory');
const ledger = { calls: [], lists: [], blockedGeneration: 0 };
const save = () => writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const flags = () => { try { return JSON.parse(readFileSync(join(directory, 'controls.json'), 'utf8')); } catch { return {}; } };
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  const control = flags();
  ledger.calls.push(channel);
  save();
  if (/generate|render|task:create-and-run/.test(channel)) {
    ledger.blockedGeneration += 1;
    save();
    throw new Error('Project QA disallows generation');
  }
  if (channel === 'task:delete' && control.failDelete) throw new Error('QA_DELETE_FAILED: 删除失败，请重试');
  if (channel === 'task:list' && control.failList) throw new Error('QA_LIST_FAILED: 项目查询失败');
  const result = await listener(event, ...args);
  if (channel === 'task:list') {
    const page = result.value;
    ledger.lists.push({ request: args[0], count: page?.items?.length, total: page?.totalCount, heavy: page?.items?.some(item => 'inputText' in item || 'pipelineData' in item) });
    save();
    if (control.delayQuery === args[0]?.query) await new Promise(resolve => setTimeout(resolve, 1800));
  }
  return result;
});
app.setPath('userData', directory);
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
save();
require(join(app.getAppPath(), require('../package.json').main));
