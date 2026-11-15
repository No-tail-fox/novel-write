import { expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { voxProductionSettings, voxProductionSingleRequestNode } from '../src/shared/vox-production';
import { buildPiFilmNodes } from '../src/shared/pi-film-graph';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { parseEditorialCollagePipelineData, restoreEditorialCollagePipelineData } from '../src/shared/editorial-collage';
it('orders voice timing before segments and audio mastering before render', () => {
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'pi', title: 'Film', ratio: '16:9' }), '道路与建筑吸收阳光。树荫降低地表温度。', '2026-10-23T00:00:00.000Z', 15000);
  const nodes = buildPiFilmNodes(document, voxProductionSettings());
  const segment = nodes.find(node => node.kind === 'agent-segment')!;
  expect(segment.dependencies.length).toBeGreaterThan(0);
  expect(segment.dependencies.every(id => nodes.some(node => node.id === id && node.kind === 'timing'))).toBe(true);
  expect(voxProductionSingleRequestNode(segment)).toBe(false);
  expect(nodes.find(node => node.id === 'render')?.dependencies).toContain('pi-audio-master');
  expect(nodes.some(node => node.id.startsWith('upstream-turn:'))).toBe(false);
});

it('creates one explicit model-context segment per bounded narration window', () => {
  const source = '事实、来源与限定。'.repeat(1400);
  const document = restoreEditorialCollagePipelineData({ ...createEditorialCollageDraft({ id: 'pi-long', title: 'Long film', ratio: '16:9' }), sourceText: source, beats: [] });
  const settings = { ...voxProductionSettings(), codeVideo: newCodeVideoPolicy() };
  const nodes = buildPiFilmNodes(document, settings).filter(node => node.id.startsWith('pi-segment:'));
  expect(nodes.length).toBeGreaterThan(1);
  expect(nodes.map(node => node.id)).toEqual(nodes.map((_, index) => `pi-segment:${index + 1}`));
});
