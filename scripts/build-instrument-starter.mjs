#!/usr/bin/env node
/** Build the CC0 Lemo starter pack from a pinned upstream release archive.
 * No samples are synthesized or recompressed: selected instrument directories are copied verbatim.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, cp } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'vendor/lemo-upstream/tools/assets.json');
const DEFAULT_OUT = join(ROOT, 'vendor/lemo-instrument-starter');
const DEFAULT_INSTRUMENTS = ['alto_sax', 'jazz_bass', 'erhu'];
const MAX_BYTES = 100 * 1024 * 1024;
const SOURCE = 'instruments-karoryfer';
const LICENSE = 'CC0 1.0';
const LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

function args(argv) {
  const out = { output: DEFAULT_OUT, instruments: DEFAULT_INSTRUMENTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--archive') out.archive = resolve(argv[++i]);
    else if (a === '--output') out.output = resolve(argv[++i]);
    else if (a === '--temp-dir') out.tempDir = resolve(argv[++i]);
    else if (a === '--download') out.download = true;
    else if (a === '--instruments') out.instruments = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--help') { console.log('Usage: node scripts/build-instrument-starter.mjs --archive <release.tar> [--download] [--temp-dir dir] [--output new-dir] [--instruments a,b,c]'); process.exit(0); }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}
const sha256 = async file => { const h = createHash('sha256'); h.update(await readFile(file)); return h.digest('hex'); };
const walk = async root => { const out=[]; const visit=async d=>{ for(const e of await readdir(d,{withFileTypes:true})){ const p=join(d,e.name); if(e.isDirectory()) await visit(p); else out.push(p); } }; await visit(root); return out.sort(); };
const runTar = (archive, dest) => { const r=spawnSync('tar',['-xf',archive,'-C',dest],{stdio:'pipe'}); if(r.status!==0) throw new Error(`tar extraction failed: ${r.stderr.toString()}`); };
const find = async (root, name) => { for(const p of await walk(root)) if(p.endsWith(`${sep}${name}`) || p.endsWith(`/${name}`)) return p; return null; };

const main = async () => {
  const opt=args(process.argv.slice(2));
  const assets=JSON.parse(await readFile(ASSETS,'utf8'));
  const pinned=assets.packs[SOURCE];
  if(!pinned) throw new Error(`Pinned asset entry missing: ${SOURCE}`);
  const url=`https://github.com/${assets.repo}/releases/download/${assets.tag}/${pinned.file}`;
  if(!opt.archive) throw new Error(`--archive is required; use --download to fetch ${url} to that new path`);
  const archive=resolve(opt.archive);
  if(opt.download) {
    if(existsSync(archive)) throw new Error(`Refusing to overwrite existing download: ${archive}`);
    await mkdir(dirname(archive),{recursive:true});
    const download=spawnSync('curl',['--fail','--location','--retry','2','--connect-timeout','30','--max-time','3600','--output',archive,url],{stdio:'inherit'});
    if(download.status!==0) throw new Error(`Public release download failed (${download.status}): ${url}; partial archive remains at ${archive}`);
  }
  const s=await stat(archive);
  if(s.size!==pinned.size) throw new Error(`Archive size mismatch: expected ${pinned.size}, got ${s.size}`);
  const actual=await sha256(archive); if(actual!==pinned.sha256) throw new Error(`Archive SHA-256 mismatch: expected ${pinned.sha256}, got ${actual}`);
  const temp=await mkdtemp(join(opt.tempDir || dirname(archive),'lemo-starter-'));
  try {
    await mkdir(join(temp,'unpack'),{recursive:true}); runTar(archive,join(temp,'unpack'));
    const extracted=await find(join(temp,'unpack'),'index.json'); if(!extracted) throw new Error('Release archive has no instruments/index.json');
    const sourceRoot=dirname(extracted); const index=JSON.parse(await readFile(extracted,'utf8'));
    const missing=opt.instruments.filter(n=>!Object.prototype.hasOwnProperty.call(index,n)); if(missing.length) throw new Error(`Requested instruments absent from index.json: ${missing.join(', ')}`);
    const selected={}; for(const n of opt.instruments) selected[n]=index[n];
    const staging=join(temp,'out'); await mkdir(join(staging,'instruments'),{recursive:true});
    // The three Karoryfer instruments together fit the budget. Preserve their entire
    // library, including SFZ files, release samples, round robins and original licenses.
    if (opt.instruments.some(n => !DEFAULT_INSTRUMENTS.includes(n))) throw new Error('Only the audited CC0 Karoryfer instruments are supported');
    await cp(join(sourceRoot,'karoryfer'),join(staging,'instruments','karoryfer'),{recursive:true});
    for (const name of opt.instruments) {
      if (!selected[name].zones?.length) throw new Error(`Empty instrument: ${name}`);
      for (const zone of selected[name].zones) {
        if (!zone.f?.startsWith('karoryfer/') || !existsSync(join(staging,'instruments',zone.f))) throw new Error(`Missing sample for ${name}: ${zone.f}`);
      }
    }
    await writeFile(join(staging,'instruments','index.json'),JSON.stringify(selected,null,2)+'\n');
    await writeFile(join(staging,'README.md'),'# StoryDream CC0 instrument starter\n\nContains complete Karoryfer libraries for alto_sax, jazz_bass and erhu. Original LICENSE/README files are retained under instruments/karoryfer. Samples are unchanged FLAC from the pinned upstream release. Only the installed instruments are listed in index.json.\n\nRebuild: node scripts/build-instrument-starter.mjs --archive <instruments-karoryfer.tar> --output <new-directory>\n');
    const files=await walk(staging); const manifestFiles=[]; let total=0;
    for(const p of files){ const rel=relative(staging,p).split(sep).join('/'); const size=(await stat(p)).size; total+=size; manifestFiles.push({path:rel,size,sha256:await sha256(p),source:rel.startsWith('instruments/karoryfer/') ? SOURCE : 'storydream-generated',license:LICENSE}); }
    if(total>MAX_BYTES) throw new Error(`Starter pack exceeds 100 MiB: ${total} bytes`);
    const manifest={schemaVersion:1,pack:'storydream-lemo-instrument-starter',license:LICENSE,licenseUrl:LICENSE_URL,sourceIndexSha256:await sha256(extracted),source:{repo:assets.repo,tag:assets.tag,asset:SOURCE,file:pinned.file,size:pinned.size,sha256:pinned.sha256,url:`https://github.com/${assets.repo}/releases/download/${assets.tag}/${pinned.file}`},instruments:opt.instruments,bytes:total,files:manifestFiles};
    if(existsSync(opt.output)) throw new Error(`Output already exists; choose a new directory: ${opt.output}`);
    if(total + Buffer.byteLength(JSON.stringify(manifest,null,2)+'\n') > MAX_BYTES) throw new Error('Starter plus manifest exceeds 100 MiB');
    await cp(staging,opt.output,{recursive:true});
    await writeFile(join(opt.output,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log(JSON.stringify({output:opt.output,bytes:total,instruments:opt.instruments,files:manifestFiles.length,archiveSha256:actual},null,2));
  } finally { await rm(temp,{recursive:true,force:true}); }
};
main().catch(e=>{console.error(`build-instrument-starter: ${e.message}`);process.exitCode=1;});
