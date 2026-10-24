import { readFileSync } from 'node:fs';
import { directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const document = raw.workflowKind === 'motion-comic'
  ? parseMotionComicPipelineData(raw) : parseEditorialCollagePipelineData(raw);
process.stdout.write(directorDocumentRenderFingerprint(document));
