// Isolated UI fixture: all copy requests return local text; generation never reaches a paid API.
const { ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated copy QA directory');
const copyRequests = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel !== 'research:compose-copy') return listener(event, ...args);
  copyRequests.push(args[0]);
  writeFileSync(join(directory, 'copy-requests.json'), JSON.stringify(copyRequests), 'utf8');
  let delayMs = 20;
  try { delayMs = JSON.parse(readFileSync(join(directory, 'copy-controls.json'), 'utf8')).delayMs ?? delayMs; } catch {}
  await new Promise(resolve => setTimeout(resolve, delayMs));
  return { ok: true, value: { title: args[0].keyword, copy: '本地验收文案：' + args[0].track + '。保留素材中的关键内容，用具体场景推进，结尾回应开头。', raw: '', requestId: 'local-copy-qa' } };
});
require('./qa-project-home.cjs');
