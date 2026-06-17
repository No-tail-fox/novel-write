# StoryDream

Windows desktop workbench for AI-assisted story, media, and local draft production:

- source text review
- short-video rewrite
- cover metadata
- storyboard sentence splitting
- image prompt generation
- subtitle timeline
- local draft package output

## Commands

Double-click `启动 StoryDream.bat` for one-click startup. It delegates to `start-storydream.ps1`.

On this machine, the npm script shim can return `Access is denied`. The direct Node commands below are verified:

```powershell
node -e "import('./node_modules/vitest/vitest.mjs')"
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
node node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit
node node_modules\vite\bin\vite.js build
node scripts\build-electron.mjs
```

For interactive development, run Vite and Electron from a normal local terminal:

```powershell
npm run dev
```

If npm is blocked by local policy, run the underlying commands separately:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
$env:NODE_ENV="development"; node node_modules\electron\cli.js .
```

## Notes

- SQLite persistence uses `sql.js` to avoid native addon compilation on Windows.
- The first draft adapter writes a stable StoryDream draft package with `draft_content.json`, `draft_meta_info.json`, images, audio, subtitles, and pipeline artifacts.
- Jianying compatibility is isolated behind the draft writer so it can be iterated against real draft samples without coupling the app shell to external internals.
