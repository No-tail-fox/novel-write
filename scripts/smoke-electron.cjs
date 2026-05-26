const { app, BrowserWindow } = require('electron');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const rootDir = join(__dirname, '..');
const indexPath = join(rootDir, 'dist-renderer', 'index.html');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-networking');

async function main() {
  if (!existsSync(indexPath)) {
    throw new Error(`Renderer build not found: ${indexPath}`);
  }

  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    width: 1320,
    height: 860,
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  await win.loadFile(indexPath);
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => resolve()))');

  const result = await win.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText;
    return {
      hasShell: Boolean(document.querySelector('.app-shell')),
      hasStorybound: text.includes('Storybound'),
      hasNewTask: text.includes('新建任务'),
      hasQueue: text.includes('任务队列'),
      textLength: text.trim().length,
    };
  })()`);

  const draftResult = await win.webContents.executeJavaScript(`(async () => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const draftButton = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('草稿模板'));
    draftButton?.click();
    await waitFrame();
    const galleryText = document.body.innerText;
    const hasDraftGallery = Boolean(document.querySelector('.draft-template-gallery'));
    const editButton = [...document.querySelectorAll('button')].find((button) => button.innerText.trim().includes('编辑'));
    editButton?.click();
    await waitFrame();
    const editorText = document.body.innerText;
    return {
      openedDraftTemplates: Boolean(draftButton),
      hasDraftGallery,
      hasBuiltinTemplates: galleryText.includes('默认竖屏') && galleryText.includes('竖屏4:3') && galleryText.includes('横屏16:9'),
      hasDraftEditorBack: editorText.includes('返回模板列表'),
    };
  })()`);
  Object.assign(result, draftResult);

  console.log(JSON.stringify(result, null, 2));

  if (
    !result.hasShell ||
    !result.hasStorybound ||
    !result.hasNewTask ||
    !result.hasQueue ||
    !result.openedDraftTemplates ||
    !result.hasDraftGallery ||
    !result.hasBuiltinTemplates ||
    !result.hasDraftEditorBack ||
    result.textLength < 100
  ) {
    throw new Error('Electron smoke test failed: renderer shell did not render expected text.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
    setTimeout(() => process.exit(process.exitCode ?? 0), 250);
  });
