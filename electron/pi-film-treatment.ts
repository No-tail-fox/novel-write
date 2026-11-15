import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Structural gate only; the model and human review still judge originality and artistic quality. */
export async function inspectPiTreatment(projectRoot: string) {
  let text = '';
  try { text = await readFile(join(projectRoot, 'TREATMENT.md'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const sections = [
    ['structures', /(?:three|3|三).{0,24}(?:structure|结构)|(?:structure|结构).{0,24}(?:three|3|三)/iu],
    ['choice', /(?:chosen|choice|选择|选定)/iu],
    ['logline', /(?:logline|一句话|梗概)/iu],
    ['arc', /(?:\barc\b|情绪弧|叙事弧)/iu],
    ['shot-list', /(?:shot\s*list|镜头表|镜头列表)/iu],
    ['beat-sheet', /(?:beat\s*sheet|节拍表|节奏表)/iu],
    ['cue-map', /(?:cue\s*map|旁白映射|旁白对照|字幕映射)/iu],
    ['sound', /(?:sound\s*design|声音设计|音频设计)/iu],
    ['captions', /(?:subtitle\s*design|caption\s*design|字幕设计)/iu],
    ['benchmark', /(?:benchmark|对标|参照作品|参考作品)/iu],
    ['differs-from-demo', /(?:differs?\s+from\s+(?:the\s+)?demo|不同于\s*demo|与\s*demo.{0,12}(?:不同|区别)|demo.{0,12}(?:不同|区别))/iu],
  ] as const;
  const missing = sections.filter(([, expression]) => !expression.test(text)).map(([name]) => name);
  return { exists: !!text.trim(), missing, structuralPassed: text.length >= 200 && missing.length === 0 };
}
