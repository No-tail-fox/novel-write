// Exercise the production navigation handler without opening real browser tabs.
const { shell } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated provider portal QA directory');
const opened = [];
shell.openExternal = async (url) => {
  let fail = false;
  try { fail = JSON.parse(readFileSync(join(directory, 'portal-controls.json'), 'utf8')).fail; } catch {}
  await new Promise(resolve => setTimeout(resolve, 350));
  if (fail) throw new Error('QA_BROWSER_FAILED: Browser launch failed');
  opened.push(url);
  writeFileSync(join(directory, 'opened-portals.json'), JSON.stringify(opened), 'utf8');
};
require('./qa-project-home.cjs');
