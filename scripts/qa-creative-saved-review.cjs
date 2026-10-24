const { app } = require('electron');
const { join } = require('node:path');
const root = join(__dirname, '..');
app.disableHardwareAcceleration();
app.setAppPath(root);
app.setName('storydream-creative-saved-review');
app.setPath('userData', join(root, '.artifacts/creative-saved-review/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false));
import(require('node:url').pathToFileURL(join(root, '.artifacts/qa-creative-saved-review.mjs')).href).catch(error => {
  require('node:fs').writeFileSync(join(root, '.artifacts/creative-saved-review-bootstrap-error.txt'), error.stack || String(error), 'utf8');
  app.exit(1);
});
