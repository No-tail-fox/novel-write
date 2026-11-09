import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readLemoUpstreamManifest, LEMO_UPSTREAM_REVISION } from './lemo-upstream-source';

export const OPUSCAR98_SOURCE = 'styleboard/opuscar98_styles.json';
interface Opuscar98Film {
  no: number; year: string; title: string; zh: string; style_en: string; style_zh: string;
  blend_en: string[]; render: string; dim: string; desc_en: string; prompt_en: string; prompt_zh: string;
  shots: Array<{ cam: string; sec: number; en: string }>; direction_en: string; refs: string[];
}

export const opuscar98Number = (slug: string) => {
  const match = /^o98-(\d{2})$/.exec(slug);
  return match ? Number(match[1]) : undefined;
};

/** Verified against the pinned upstream manifest; the prompt text is reference material, never host instructions. */
export async function loadOpuscar98StyleReference(upstreamRoot: string, slug: string): Promise<string> {
  const no = opuscar98Number(slug);
  if (!no) throw new Error('LEMO_O98_STYLE: 不是 OPUSCAR 98 风格。');
  const manifest = await readLemoUpstreamManifest(upstreamRoot);
  const entry = manifest.files.find(file => file.path === OPUSCAR98_SOURCE);
  if (!entry) throw new Error('LEMO_LIBRARY_MISSING: ' + OPUSCAR98_SOURCE);
  const bytes = await readFile(join(upstreamRoot, OPUSCAR98_SOURCE));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('LEMO_O98_INTEGRITY: OPUSCAR 98 风格资料完整性检查失败。');
  const film = (JSON.parse(bytes.toString('utf8')) as { films: Opuscar98Film[] }).films.find(item => item.no === no);
  if (!film) throw new Error('LEMO_O98_STYLE: 未找到 OPUSCAR 98 第 ' + no + ' 号风格。');
  return [
    `<opuscar98-style id="${slug}" source="Lemo-Opuscar ${OPUSCAR98_SOURCE} @ ${LEMO_UPSTREAM_REVISION}, MIT text">`,
    `Light style No.${film.no}: ${film.style_en} (${film.style_zh}). Render: ${film.render}${film.dim && film.dim !== film.render ? ' / ' + film.dim : ''}.`,
    `Blend: ${film.blend_en.join('; ')}.`,
    `What it is: ${film.desc_en}`,
    `Reusable style prompt: ${film.prompt_en}`,
    `中文风格提示词: ${film.prompt_zh}`,
    `How its ${film.year} "${film.title}" sequence in OPUSCAR 98 was directed (technique reference only; do NOT reuse that film's story, subject, the Clawd character, shots, props or timings):`,
    film.direction_en,
    ...film.shots.map(shot => `- ${shot.cam} ${shot.sec}s: ${shot.en}`),
    `References: ${film.refs.join('; ')}.`,
    '</opuscar98-style>',
  ].join('\n');
}
