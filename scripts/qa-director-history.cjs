// Install local media fixtures before loading the real production IPC handlers.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_HISTORY_QA_DIR;
if (!directory) throw new Error('Missing isolated history QA directory');
const ledger = { installed: true, calls: [], imageRequests: 0, voiceRequests: 0, blockedExternalCalls: 0 };
const save = () => writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (['image-lab:generate', 'voice-lab:generate', 'director:generate-shot-video', 'director:render', 'local-audio:select'].includes(channel)) {
    ledger.calls.push(channel);
    save();
  }
  return listener(event, ...args);
});
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.origin === 'https://qa.invalid' && ['/v1/images/generations', '/v1/images/edits'].includes(url.pathname)) {
    ledger.imageRequests += 1;
    save();
    return Response.json({ data: [{ b64_json: readFileSync(join(directory, 'frame.png')).toString('base64') }] });
  }
  if (url.href === 'https://api.minimaxi.com/v1/t2a_v2') {
    ledger.voiceRequests += 1;
    save();
    return Response.json({ data: { audio: readFileSync(join(directory, 'voice.wav')).toString('hex') }, base_resp: { status_code: 0 } });
  }
  ledger.blockedExternalCalls += 1;
  save();
  throw new Error('History QA blocked unexpected external fetch: ' + url.origin);
};
save();
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
require(join(app.getAppPath(), require('../package.json').main));
