// Isolated host running the unmodified production IPC/runtime, including paid providers.
const { app } = require('electron');
const { join } = require('node:path');
const profile = process.env.VOX_PRODUCTION_QA_DIR;
if (!profile) throw new Error('Missing isolated Vox QA directory');
app.setPath('userData', profile);
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
// Local refinement must reuse paid receipts; block HTTP(S) in Electron's default session.
// Node/undici networking is outside this guard; request IDs and attempts are checked separately.
if (process.env.VOX_QA_OFFLINE_REUSE === '1') {
  app.whenReady().then(() => require('electron').session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] }, (details, done) => {
      console.error('VOX_QA_BLOCKED_NETWORK', new URL(details.url).origin);
      done({ cancel: true });
    },
  ));
}
// Keep acceptance windows out of the user's authoring session.
// Playwright's stability checks and Remotion still need animation frames while hidden.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.hide();
  window.once('ready-to-show', () => window.hide());
});
require(join(app.getAppPath(), require('../package.json').main));
