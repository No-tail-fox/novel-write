const { app } = require('electron');
const { join } = require('node:path');
const root = join(__dirname, '..');
app.disableHardwareAcceleration();
app.setAppPath(root);
app.setName('storydream-creative-quality-v3');
app.setPath('userData', join(root, '.artifacts/creative-quality-v3/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false));
import(require('node:url').pathToFileURL(join(root, '.artifacts/qa-creative-quality-v3.mjs')).href).catch(error => {
  require('node:fs').writeFileSync(join(root, '.artifacts/creative-quality-v3-bootstrap-error.txt'), error.stack || String(error), 'utf8');
  app.exit(1);
});
