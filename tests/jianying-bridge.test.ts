import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPyJianYingDraftBridge, writePyJianYingBridgeInput, writePyJianYingBridgeScript } from '@shared/jianying-bridge';

describe('pyJianYingDraft bridge input', () => {
  it('writes a self-contained bridge payload for Python draft generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-bridge-'));

    try {
      const payloadPath = await writePyJianYingBridgeInput({
        workDir: dir,
        draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
        title: 'Bridge Draft',
        canvas: { width: 1080, height: 1920 },
        imageArea: { top: 0, height: 1280, fit: 'cover' },
        caption: { fontSize: 44, color: '#ffffff', y: 1480 },
        images: [{ sceneId: 1, path: join(dir, 'image.png') }],
        narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
        subtitlesSrtPath: join(dir, 'subtitles.srt'),
        bgm: null,
      });
      const payload = JSON.parse(await readFile(payloadPath, 'utf8'));

      expect(payload.title).toBe('Bridge Draft');
      expect(payload.draftDir).toContain('Bridge Draft');
      expect(payload.images[0]).toMatchObject({ sceneId: 1, path: join(dir, 'image.png') });
      expect(payload.narration[0]).toMatchObject({ sceneId: 1, path: join(dir, 'voice.mp3') });
      expect(payload.canvas).toEqual({ width: 1080, height: 1920 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the Python bridge script with the pyJianYingDraft draft API path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-script-'));

    try {
      const scriptPath = await writePyJianYingBridgeScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('DraftFolder');
      expect(script).toContain('VideoSegment');
      expect(script).toContain('AudioSegment');
      expect(script).toContain('import_srt');
      expect(script).toContain('script.save()');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('executes Python with the bridge script and parses the generated draft paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-run-'));
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    try {
      const draftDir = join(dir, 'Draft Root', 'Bridge Draft');
      const output = await runPyJianYingDraftBridge(
        {
          workDir: dir,
          draftDir,
          title: 'Bridge Draft',
          canvas: { width: 1080, height: 1920 },
          imageArea: { top: 0, height: 1, fit: 'cover' },
          caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
          scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
          images: [{ sceneId: 1, path: join(dir, 'image.png') }],
          narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
          subtitlesSrtPath: join(dir, 'subtitles.srt'),
          bgm: null,
          totalDurationUs: 1_200_000,
          volumes: { narration: 1, bgm: 0.3 },
        },
        {
          pythonCommand: 'python-test',
          execute: async (command, args, options) => {
            calls.push({ command, args, cwd: options.cwd });
            return {
              stdout: JSON.stringify({
                ok: true,
                draftDir,
                draftContentPath: join(draftDir, 'draft_content.json'),
                draftMetaPath: join(draftDir, 'draft_meta_info.json'),
                durationUs: 1_200_000,
              }),
              stderr: '',
            };
          },
        },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('python-test');
      expect(calls[0].args[0]).toMatch(/pyjianying-bridge[\\/]bridge\.py$/);
      expect(calls[0].args[1]).toMatch(/pyjianying-bridge[\\/]input\.json$/);
      expect(calls[0].cwd).toBe(dir);
      expect(output).toMatchObject({
        draftDir,
        draftContentPath: join(draftDir, 'draft_content.json'),
        draftMetaPath: join(draftDir, 'draft_meta_info.json'),
        durationUs: 1_200_000,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a clear install command when pyJianYingDraft is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-jy-missing-'));

    try {
      const error = Object.assign(new Error('Command failed'), {
        stderr: "ModuleNotFoundError: No module named 'pyJianYingDraft'",
      });

      await expect(
        runPyJianYingDraftBridge(
          {
            workDir: dir,
            draftDir: join(dir, 'Draft Root', 'Bridge Draft'),
            title: 'Bridge Draft',
            canvas: { width: 1080, height: 1920 },
            imageArea: { top: 0, height: 1, fit: 'cover' },
            caption: { fontSize: 44, color: '#ffffff', y: -0.8 },
            scenes: [{ sceneId: 1, startUs: 0, durationUs: 1_200_000, text: 'hello' }],
            images: [{ sceneId: 1, path: join(dir, 'image.png') }],
            narration: [{ sceneId: 1, path: join(dir, 'voice.mp3') }],
            subtitlesSrtPath: join(dir, 'subtitles.srt'),
            bgm: null,
            totalDurationUs: 1_200_000,
            volumes: { narration: 1, bgm: 0.3 },
          },
          {
            execute: async () => {
              throw error;
            },
          },
        ),
      ).rejects.toThrow(/python -m pip install pyJianYingDraft/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
