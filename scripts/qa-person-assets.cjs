// Isolated QA host: only the native picker, directory opening, and failures are stubbed.
const { dialog, ipcMain, shell } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join, relative, isAbsolute } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated person asset QA directory');
const controls = () => {
  try { return JSON.parse(readFileSync(join(directory, 'asset-controls.json'), 'utf8')); }
  catch { return {}; }
};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'person-assets:usage' && controls().failUsage) {
    return { ok: false, error: { code: 'QA_USAGE_FAILED', message: '素材引用查询失败，请重试', retryable: true, diagnosticId: 'qa-person-usage' } };
  }
  return listener(event, ...args);
});
dialog.showOpenDialog = async () => {
  if (controls().failImport) throw new Error('QA_IMPORT_FAILED: 图片导入失败，请重试');
  return controls().cancelImport
    ? { canceled: true, filePaths: [] }
    : { canceled: false, filePaths: [join(directory, 'fixtures', 'asset-preview.png')] };
};
shell.openPath = async (path) => {
  const suffix = relative(directory, path);
  if (suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('QA refuses paths outside isolated profile');
  writeFileSync(join(directory, 'opened-directory.json'), JSON.stringify({ path }), 'utf8');
  return '';
};
require('./qa-project-home.cjs');
