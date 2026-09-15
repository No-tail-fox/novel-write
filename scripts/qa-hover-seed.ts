import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';

const profile = resolve(process.argv[2]);
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  await db.createEditorialCollageTask({ title: 'Hover QA VOX', sourceText: 'First scene. Second scene.', durationMs: 'auto' });
  await db.upsertUiPreferences({ activeView: 'projects', theme: 'dark' });
} finally {
  await db.close();
}
