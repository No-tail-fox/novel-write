import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const directory = resolve('.artifacts/stock-media-ui-20261102');
await mkdir(directory, { recursive: true });
await build({ entryPoints: ['tests/stock-media-ui.harness.tsx'], bundle: true, platform: 'browser', format: 'iife', outfile: join(directory, 'harness.js'), loader: { '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' } });
await writeFile(join(directory, 'index.html'), '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"></head><body style="margin:0"><div id="root"></div><script src="harness.js"></script></body></html>', 'utf8');
await writeFile(join(directory, 'main.cjs'), "const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',__dirname+'/profile');app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});w.loadFile(__dirname+'/index.html');});app.on('window-all-closed',()=>app.quit());", 'utf8');
console.log(directory);
