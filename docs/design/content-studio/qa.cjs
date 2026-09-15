// Isolated renderer checks for this design artifact. Never loads the production app.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const output = resolve(__dirname, '../../../.artifacts/content-studio-design');
mkdirSync(output, { recursive: true });
app.setPath('userData', join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const report = { checks: [], screenshots: [], errors: [], downloads: [] };
let win;
const run = (code) => win.webContents.executeJavaScript(code, true);
const settle = () => new Promise(r => setTimeout(r, 110));
async function clickText(text, role = 'button') {
  await run(`(() => { const elements=[...document.querySelectorAll(${JSON.stringify(role === 'tab' ? '[role="tab"]' : 'button')})]; const el=elements.find(e=>[${JSON.stringify(text)},${JSON.stringify(text+text)}].includes(e.textContent.trim()) || e.getAttribute('aria-label')===${JSON.stringify(text)}); if(!el)throw new Error('Control missing: '+${JSON.stringify(text)}+'; found: '+elements.map(e=>e.textContent.trim()).join('|')); el.click(); })()`); await settle();
}
async function fill(label, value) {
  await run(`(() => { const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===${JSON.stringify(label)}); const el=label&&document.getElementById(label.htmlFor); if(!el)throw new Error('Field missing: '+${JSON.stringify(label)}); const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`); await settle();
}
async function check(name, code) { const result = await run(code); if (!result) throw new Error(`Failed: ${name}`); report.checks.push(name); }
async function capture(name, width = 1440, height = 900) {
  win.setContentSize(width, height); await settle();
  const actual = await run('({w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1})');
  if (actual.overflow) throw new Error(`${name}: horizontal overflow`);
  await win.webContents.executeJavaScript('document.fonts.ready');
  writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  report.screenshots.push({ name, ...actual });
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 900, frame: false, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_e, level, message) => { if(level >= 3)report.errors.push(message); });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('blob:') && !details.url.startsWith('data:') }));
  win.webContents.session.on('will-download', (_e, item) => {
    const path = join(output, item.getFilename()); item.setSavePath(path);
    item.once('done', (_e, state) => report.downloads.push({ path, state }));
  });
  try {
    await win.loadFile(join(__dirname, 'index.html')); await settle();
    await run(`localStorage.removeItem('storydream-content-design-v1')`); await win.loadFile(join(__dirname, 'index.html')); await settle();
    await check('note editor renders six sample pages', `document.querySelectorAll('.cs-outline-item').length===6 && document.querySelector('h1').textContent==='图文笔记'`);
    await capture('note-dark-1440');
    await fill('页面标题', '测试标题\n保留换行');
    await check('edit updates selected canvas', `document.querySelector('.cs-paper-main h2').textContent===${JSON.stringify('测试标题\n保留换行')}`);
    await clickText('抖音图文', 'tab');
    await check('platform version preserves separate text', `!document.querySelector('.cs-paper-main h2').textContent.includes('测试标题')`);
    await clickText('小红书','tab');
    await check('switching back keeps manual edit', `document.querySelector('.cs-paper-main h2').textContent.includes('测试标题')`);
    await fill('页面标题', '把一周，\n过得更有条理');
    await clickText('添加页面');
    await check('add selects new page', `document.querySelectorAll('.cs-outline-item').length===7 && document.querySelector('.cs-paper-main h2').textContent==='写下这一页的重点'`);
    await clickText('向上移动');
    await check('reordering preserves canonical selection', `[...document.querySelectorAll('.cs-outline-item')].findIndex(e=>e.getAttribute('aria-pressed')==='true')===5`);
    await clickText('复制当前内容');
    await check('duplicate adds selected copy', `document.querySelectorAll('.cs-outline-item').length===8`);
    await clickText('版式','tab');
    await run(`(() => { const select=document.querySelector('select'); select.value='1:1'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`); await settle();
    await check('ratio changes actual canvas geometry', `(() => {const c=document.querySelector('.cs-note-paper').getBoundingClientRect();return Math.abs(c.width-c.height)<2})()`);
    await clickText('配文','tab');
    await fill('发布标题', '验证独立发布标题');
    await clickText('预览','tab');
    await check('preview combines separate caption and page text', `document.querySelector('.cs-feed-caption h3').textContent==='验证独立发布标题' && document.querySelector('.cs-paper-main h2').textContent==='写下这一页的重点'`);
    await clickText('保存');
    await check('local save persists all platform versions', `JSON.parse(localStorage.getItem('storydream-content-design-v1')).variants.xiaohongshu.title==='验证独立发布标题'`);
    await win.loadFile(join(__dirname, 'index.html')); await settle();
    await check('reload reopens saved content', `document.querySelectorAll('.cs-outline-item').length===8`);
    await clickText('文章博文');
    await fill('文章标题', '一个可导出的测试标题');
    await fill('段落正文', '<script>window.bad=true</script>\n\n这是一段测试正文。');
    await clickText('导出');
    await clickText('下载文件');
    for(let n=0;n<30 && report.downloads.length===0;n++)await settle();
    if(report.downloads[0]?.state!=='completed')throw new Error('HTML download failed');
    const exported=readFileSync(report.downloads[0].path,'utf8');
    if(!exported.includes('&lt;script&gt;window.bad=true&lt;/script&gt;')||exported.includes('<script>window.bad'))throw new Error('Unsafe HTML export');
    report.checks.push('HTML download preserves Unicode and escapes active markup');
    await clickText('导出');
    await run(`(() => {const s=document.querySelector('[role="dialog"] select');s.value='markdown';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();await clickText('下载文件');
    for(let n=0;n<30 && report.downloads.length<2;n++)await settle();
    if(report.downloads[1]?.state!=='completed'||!readFileSync(report.downloads[1].path,'utf8').startsWith('# 一个可导出的测试标题'))throw new Error('Markdown download failed');
    report.checks.push('Markdown download contains edited title and body');
    await fill('文章标题','');await clickText('导出');
    await check('missing title blocks export', `[...document.querySelectorAll('[role="dialog"] button')].some(e=>e.textContent.trim()==='下载文件'&&e.disabled)`);await clickText('取消');
    // Reset isolated example state for clean visual captures.
    await clickText('保存');
    await run(`localStorage.removeItem('storydream-content-design-v1')`);await win.loadFile(join(__dirname,'index.html'));await settle();
    await capture('note-dark-1040',1040,720);
    await capture('note-dark-390',390,844);
    await capture('note-dark-1440',1440,900);
    await clickText('切换浅色主题');await capture('note-light-1440');
    await clickText('预览','tab');await capture('note-preview-light-1440');
    await clickText('切换深色主题');await clickText('文章博文');await capture('article-dark-1440');
    await capture('article-dark-1040',1040,720);await capture('article-dark-390',390,844);
    win.setContentSize(1440,900);await settle();await clickText('预览','tab');await capture('article-preview-dark-1440');
    await clickText('博客 / 网站','tab');await check('blog preview includes anchor-linked contents', `document.querySelectorAll('.cs-article-toc a').length===6`);await capture('blog-preview-dark-1440');
    await run(`document.querySelectorAll('.cs-outline-item')[3].click()`);await settle();
    await check('outline selection scrolls article preview to section', `document.querySelector('.cs-canvas-scroll').scrollTop>200`);
    await clickText('新建创作');await capture('creation-start-dark-1440');
    await run(`document.querySelector('.cs-type-card').click()`);await settle();await clickText('整理成文章');await clickText('复制结构并打开');
    await check('structural conversion opens article without changing source', `document.querySelector('h1').textContent==='文章博文' && document.querySelectorAll('.cs-outline-item').length===6`);
    await clickText('图文笔记');await check('source survives conversion', `document.querySelector('.cs-paper-main h2').textContent===${JSON.stringify('把一周，\n过得更有条理')}`);
    await check('buttons have accessible names', `[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length===0`);
    if(report.errors.length)throw new Error(report.errors.join('\n'));
    report.status='passed';
  } catch(error) { report.status='failed';report.errors.push(String(error.stack||error)); }
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify(report)); app.exit(report.status==='passed'?0:1);
});
setTimeout(()=>{console.error('Prototype QA timed out');app.exit(2)},60000).unref();
