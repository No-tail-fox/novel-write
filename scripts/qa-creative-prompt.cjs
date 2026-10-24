const { app } = require('electron');
const { join } = require('node:path');
const root = join(__dirname, '..');
app.disableHardwareAcceleration();
app.setAppPath(root);
app.setName('storydream-creative-prompt');
app.setPath('userData', join(root, '.artifacts/creative-integration/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false));
import(require('node:url').pathToFileURL(join(root, '.artifacts/qa-creative-prompt.mjs')).href).catch(error => {
  console.error(error); app.exit(1);
});
