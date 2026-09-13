// Isolated Electron entry point: install fault injection before loading production main.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_BATCH_QA_DIR;
if (!directory) throw new Error('Missing isolated batch QA directory');
const ledger = { installed: true, batchWrites: 0, injectedFailures: 0, generationCalls: [], remoteCalls: 0 };
const save = () => writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const control = () => JSON.parse(readFileSync(join(directory, 'control.json'), 'utf8'));
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'director:batch-create' && control().createDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, control().createDelayMs));
  }
  if (channel === 'director:batch-update') {
    ledger.batchWrites += 1;
    const settings = control();
    const nodes = args[0]?.patch?.nodes;
    if (settings.failRunning && nodes?.some((node) => node.status === 'running')) {
      ledger.injectedFailures += 1;
      save();
      throw new Error('QA_BATCH_DISK_WRITE_FAILED');
    }
  }
  if (['image-lab:generate', 'voice-lab:generate', 'director:generate-shot-video', 'director:render'].includes(channel)) {
    ledger.generationCalls.push(channel);
    save();
    throw new Error('QA forbids provider execution');
  }
  save();
  return listener(event, ...args);
});
globalThis.fetch = () => {
  ledger.remoteCalls += 1;
  save();
  return Promise.reject(new Error('Batch QA forbids network generation'));
};
save();
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
require(join(app.getAppPath(), require('../package.json').main));
