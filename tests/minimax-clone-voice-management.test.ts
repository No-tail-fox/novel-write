import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { mergeMinimaxCloneVoice } from '../src/shared/minimax-clone-voices';
import { FileDatabase } from '../src/shared/storage';
import { ttsVoiceOptionsForProvider } from '../src/shared/tts-voices';
import type { MinimaxCloneVoice } from '../src/shared/types';

const savedVoice: MinimaxCloneVoice = {
  voiceId: 'voice-existing-001',
  displayName: '旧名称',
  sourceAudioPath: 'D:/voices/original.wav',
  createdAt: 100,
  lastUsedAt: 200,
};

describe('MiniMax clone voice management', () => {
  it('accepts only strict bounded save and delete inputs over IPC', () => {
    expect(ipcInputSchemas['minimax-clone-voice:save'].safeParse({
      voiceId: 'voice-existing-001',
      displayName: '纪录片旁白',
      sourceAudioPath: 'D:/voices/original.wav',
    }).success).toBe(true);
    expect(ipcInputSchemas['minimax-clone-voice:save'].safeParse({
      voiceId: 'voice-existing-001',
      displayName: '纪录片旁白',
      sourceAudioPath: '',
      unknown: true,
    }).success).toBe(false);
    expect(ipcInputSchemas['minimax-clone-voice:save'].safeParse({ voiceId: '', displayName: '' }).success).toBe(false);
    expect(ipcInputSchemas['minimax-clone-voice:delete'].safeParse('voice-existing-001').success).toBe(true);
    expect(ipcInputSchemas['minimax-clone-voice:delete'].safeParse({ voiceId: 'voice-existing-001' }).success).toBe(false);
  });

  it('keeps main-owned timestamps while updating user-editable metadata', () => {
    expect(mergeMinimaxCloneVoice(savedVoice, {
      voiceId: savedVoice.voiceId,
      displayName: '纪录片旁白',
      sourceAudioPath: 'D:/voices/new.wav',
    }, 999)).toEqual({
      ...savedVoice,
      displayName: '纪录片旁白',
      sourceAudioPath: 'D:/voices/new.wav',
    });
    expect(mergeMinimaxCloneVoice(null, {
      voiceId: 'voice-new-001',
      displayName: '新音色',
      sourceAudioPath: '',
    }, 999)).toEqual({
      voiceId: 'voice-new-001',
      displayName: '新音色',
      sourceAudioPath: '',
      createdAt: 999,
      lastUsedAt: 0,
    });
  });

  it('persists, reads, and deletes clone voices without touching source audio files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-clone-voice-management-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      await db.upsertMinimaxCloneVoice(savedVoice);
      expect(await db.getMinimaxCloneVoice(savedVoice.voiceId)).toEqual(savedVoice);
      expect(await db.deleteMinimaxCloneVoice(savedVoice.voiceId)).toBe(true);
      expect(await db.getMinimaxCloneVoice(savedVoice.voiceId)).toBeNull();
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds loaded clone voices to MiniMax choices without duplicating built-ins', () => {
    const options = ttsVoiceOptionsForProvider('minimax', [
      savedVoice,
      { ...savedVoice, voiceId: 'male-qn-qingse', displayName: '重复预设' },
    ]);
    expect(options.filter((option) => option.id === 'male-qn-qingse')).toHaveLength(1);
    expect(options).toContainEqual({ id: savedVoice.voiceId, label: savedVoice.displayName, hint: '克隆音色' });
  });

  it('exposes paginated settings management and real consumer selection owners', async () => {
    const [settings, manager, api, preload, main, qa] = await Promise.all([
      readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/MinimaxCloneVoiceManager.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8'),
    ]);
    expect(settings).toContain('<MinimaxCloneVoiceManager');
    expect(manager).toContain('api.listMinimaxCloneVoices');
    expect(manager).toContain('api.selectLocalAudio');
    expect(manager).toContain('api.saveMinimaxCloneVoice');
    expect(manager).toContain('api.deleteMinimaxCloneVoice');
    expect(manager).toContain('const [editorOpen, setEditorOpen] = useState(false)');
    expect(manager).toContain('setEditorOpen(true)');
    expect(manager).toContain('{editorOpen ? (');
    expect(manager).toContain('setEditorOpen(false)');
    expect(manager).toContain('加载更多');
    expect(api).toContain('saveMinimaxCloneVoice:');
    expect(api).toContain('deleteMinimaxCloneVoice:');
    expect(preload).toContain("invokeTrusted('minimax-clone-voice:save'");
    expect(preload).toContain("invokeTrusted('minimax-clone-voice:delete'");
    expect(main).toContain("trustedHandle('minimax-clone-voice:save'");
    expect(main).toContain("trustedHandle('minimax-clone-voice:delete'");
    expect(main).toContain("editorialQaConfig?.scope === 'clone-voice'");
    expect(qa).toContain('minimax-clone-voice-create-light-desktop');
    expect(qa).toContain('minimax-clone-voice-edit-dark-desktop');
    expect(qa).toContain('minimax-clone-voice-delete-light-compact');
  });
});
