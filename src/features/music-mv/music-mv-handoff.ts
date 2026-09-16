export interface MusicMvHandoff {
  id: string;
  title: string;
  lyrics: string;
  audioPath: string;
}

interface MusicMvAudioDraft {
  title: string;
  lyrics: string;
  musicMvAudioPath: string;
  bgmId: string;
}

export function applyMusicMvHandoff<T extends MusicMvAudioDraft>(draft: T, music: MusicMvHandoff): T {
  return {
    ...draft,
    title: music.title,
    lyrics: music.lyrics,
    musicMvAudioPath: music.audioPath,
    bgmId: '',
  };
}
