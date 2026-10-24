// UI fixtures only; real protocol verification lives in tests/licensing.test.ts.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_LICENSE_QA_DIR;
if (!directory) throw new Error('Missing isolated license QA directory');
const controls = join(directory, 'controls.json');
const calls = [];
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => original(channel, async (event, ...args) => {
  if (channel.startsWith('license:') || channel.startsWith('update:')) {
    calls.push({ channel, args });
    writeFileSync(join(directory, 'calls.json'), JSON.stringify(calls), 'utf8');
    const state = JSON.parse(readFileSync(controls, 'utf8'));
    if (channel === 'license:activate') state.license = state.active;
    if (channel === 'license:release') state.license = state.inactive;
    if (channel === 'update:download') state.update = state.ready;
    if (channel === 'update:install') return { ok: false, error: { code: 'UPDATE_APP_BUSY', message: state.busyMessage } };
    writeFileSync(controls, JSON.stringify(state), 'utf8');
    return { ok: true, value: channel.startsWith('license:') ? state.license : state.update };
  }
  if (/generate|render|task:create-and-run/.test(channel)) throw new Error('License UI QA disallows generation');
  const result = await listener(event, ...args);
  if (channel === 'app:get-bootstrap' && result.ok) {
    result.value.ui.activeView = 'activation';
    result.value.ui.theme = 'light';
  }
  return result;
});
app.setPath('userData', directory);
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('browser-window-created', (_event, window) => { window.webContents.setBackgroundThrottling(false); });
require(join(app.getAppPath(), require('../package.json').main));
