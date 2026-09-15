const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const { join } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const profile = process.env.STORYDREAM_DISK_QA_DIR;
if (!profile) throw new Error('Missing isolated disk QA profile');
const ledger = { diskChecks: [], renderCalls: 0, copiedMedia: 0, windows: 0, externalCalls: 0 };
const save = () => fs.writeFileSync(join(profile, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const originalStatfs = promises.statfs;
promises.statfs = async (...args) => {
  const low = fs.existsSync(join(profile, 'low-disk.flag'));
  ledger.diskChecks.push({ path: String(args[0]), low });
  save();
  return low ? { bavail: 1, bsize: 1024 } : originalStatfs(...args);
};
const originalCopy = promises.copyFile;
promises.copyFile = async (...args) => {
  if (String(args[1]).includes('director-media')) { ledger.copiedMedia += 1; save(); }
  return originalCopy(...args);
};
syncBuiltinESMExports();
app.on('browser-window-created', () => { ledger.windows += 1; save(); });
globalThis.fetch = async () => { ledger.externalCalls += 1; save(); throw new Error('Disk QA forbids external calls'); };
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'director:render') { ledger.renderCalls += 1; save(); }
  return listener(event, ...args);
});
save();
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
require(join(app.getAppPath(), require('../package.json').main));
