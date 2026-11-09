const { app } = require('electron');
const { join } = require('node:path');
const root = join(__dirname, '..');
app.disableHardwareAcceleration();
app.setAppPath(root);
app.setPath('userData', join(root, '.artifacts/video-continuity/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('browser-window-created', (_, window) => window.webContents.setBackgroundThrottling(false));
import(require('node:url').pathToFileURL(join(root, '.artifacts/qa-video-continuity.mjs')).href).catch(error => {
  console.error(error); app.exit(1);
});
