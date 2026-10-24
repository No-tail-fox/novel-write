const { app, ipcMain } = require('electron');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const directory = process.env.STORYDREAM_THEME_QA_DIR;
if (!directory) throw new Error('Missing isolated theme QA directory');
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => register(channel, async (event, ...args) => {
  if (channel === 'ui:save-preferences' && args[0]?.theme) {
    const controls = JSON.parse(readFileSync(join(directory, 'controls.json'), 'utf8'));
    if (controls.failThemeSave) {
      return { ok: false, error: {
        code: 'ENOSPC', message: 'ENOSPC: no space left on device, write',
        retryable: true, diagnosticId: 'theme-qa-save-failure',
      } };
    }
  }
  if (/generate|render|task:create-and-run/.test(channel)) throw new Error('Theme QA disallows generation');
  return listener(event, ...args);
});
app.setPath('userData', directory);
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
});
require(join(app.getAppPath(), require('../package.json').main));
