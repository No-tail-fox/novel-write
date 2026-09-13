const { app, ipcMain } = require('electron');
const { appendFileSync, existsSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');

const logPath = process.env.STORYDREAM_QA_LIFECYCLE_LOG;
function record(event, detail = {}) {
  if (logPath) appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail }) + '\n', 'utf8');
}

record('process-start');
globalThis.fetch = async () => { record('network-blocked'); throw new Error('Quality QA forbids network calls'); };
process.on('exit', code => record('process-exit', { code }));
process.on('uncaughtExceptionMonitor', error => record('uncaught-exception', { message: error.message, stack: error.stack }));
for (const name of ['before-quit', 'will-quit', 'window-all-closed']) app.on(name, () => record(name));
app.on('child-process-gone', (_event, details) => record('child-process-gone', details));
app.on('browser-window-created', (_event, window) => {
  const windowId = window.id;
  record('window-created', { windowId });
  window.on('close', () => record('window-close', { windowId, stack: new Error().stack }));
  window.on('closed', () => record('window-closed', { windowId }));
  window.webContents.on('did-finish-load', () => record('window-loaded', { windowId, url: window.webContents.getURL() }));
  window.webContents.on('render-process-gone', (_event, details) => record('render-process-gone', { windowId, ...details }));
  const execute = window.webContents.executeJavaScript.bind(window.webContents);
  window.webContents.executeJavaScript = (script, ...args) => {
    const flag = process.env.STORYDREAM_QA_FAULT_DIR && join(process.env.STORYDREAM_QA_FAULT_DIR, 'subtitle-measurement-fail.flag');
    if (flag && existsSync(flag) && script.includes('Subtitle frame or loaded fonts unavailable.')) {
      unlinkSync(flag); record('subtitle-measurement-fail', { windowId });
      return Promise.reject(new Error('QA subtitle measurement failure'));
    }
    const visibilityFlag = process.env.STORYDREAM_QA_FAULT_DIR && join(process.env.STORYDREAM_QA_FAULT_DIR, 'subtitle-visibility-fail.flag');
    if (visibilityFlag && existsSync(visibilityFlag) && script.includes('window.__tl') && script.includes('activeCueIds') && script.includes('data-cue-start')) {
      unlinkSync(visibilityFlag); record('subtitle-visibility-fail', { windowId });
      return execute(script, ...args).then(samples => {
        if (!Array.isArray(samples) || samples.length === 0) return samples;
        return samples.map((sample, index) => index === 0 ? { ...sample, activeCueIds: [] } : sample);
      });
    }
    return execute(script, ...args);
  };
});

const faultDir = process.env.STORYDREAM_QA_CONFIRMATION_FAULT_DIR;
if (faultDir) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    if (['editorial-collage:save', 'motion-comic:save'].includes(channel)
      && args[0]?.document?.qualityReports?.some(report => report.manualReview)) {
      for (const fault of ['fail', 'delay']) {
        const flag = join(faultDir, `${fault}.flag`);
        if (!existsSync(flag)) continue;
        unlinkSync(flag);
        record('confirmation-save-' + fault, { channel });
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (fault === 'fail') throw new Error('QA_CONFIRMATION_SAVE_FAILED');
      }
    }
    return listener(event, ...args);
  });
}

app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
require(join(app.getAppPath(), require('../package.json').main));
