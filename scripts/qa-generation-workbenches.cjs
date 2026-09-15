// Exercise production IPC, vault, provider adapter and media normalization with local fixtures.
const { app, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated generation QA directory');
const ledger = { submissions: [], blockedCalls: [] };
const save = () => writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger), 'utf8');
const flags = () => { try { return JSON.parse(readFileSync(join(directory, 'controls.json'), 'utf8')); } catch { return {}; } };
global.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'video.example' || url.pathname !== '/v1/videos/generations') {
    ledger.blockedCalls.push(url.origin + url.pathname); save();
    throw new Error('Generation QA blocks external traffic');
  }
  const body = JSON.parse(String(init?.body ?? '{}'));
  ledger.submissions.push({ prompt: body.prompt, duration: body.duration, ratio: body.aspect_ratio, firstFrame: Boolean(body.first_frame_image) });
  save();
  await new Promise(resolve => setTimeout(resolve, 600));
  if (flags().fail) return new Response('QA video provider failure', { status: 500 });
  return Response.json({ id: `qa-video-${ledger.submissions.length}`, status: 'completed', video_base64: readFileSync(join(directory, 'fixture.mp4')).toString('base64') });
};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (/generate|render|task:create-and-run/.test(channel) && channel !== 'video-lab:generate') {
    ledger.blockedCalls.push(channel); save();
    throw new Error('Generation QA only permits the standalone video fixture');
  }
  return listener(event, ...args);
});
app.setPath('userData', directory);
app.setAppPath(join(__dirname, '..'));
app.setName('storydream');
save();
require(join(app.getAppPath(), require('../package.json').main));
