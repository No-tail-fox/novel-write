import { describe, expect, it } from 'vitest';
import { parseDraftTemplate } from '@shared/draft-template-contract';
import { draftTemplates } from '@shared/templates';

describe('draft template contract', () => {
  it('accepts every complete built-in template without dropping nested fields', () => {
    for (const template of draftTemplates) {
      expect(parseDraftTemplate(structuredClone(template))).toEqual(template);
    }
  });

  it.each([
    ['unknown root key', (value: any) => { value.unknown = true; }],
    ['unknown canvas key', (value: any) => { value.canvas.unknown = true; }],
    ['unknown frame key', (value: any) => { value.frame.unknown = true; }],
    ['unknown text key', (value: any) => { value.title.unknown = true; }],
    ['unknown border key', (value: any) => { value.caption.border.unknown = true; }],
    ['unknown background key', (value: any) => { value.caption.background.unknown = true; }],
    ['unknown audio key', (value: any) => { value.audio.unknown = true; }],
    ['invalid canvas width', (value: any) => { value.canvas.width = 0; }],
    ['invalid canvas height', (value: any) => { value.canvas.height = 9000; }],
    ['invalid ratio', (value: any) => { value.canvas.ratio = 'wide'; }],
    ['invalid coordinate', (value: any) => { value.title.x = 3; }],
    ['invalid width', (value: any) => { value.subtitle.width = 0.01; }],
    ['NaN', (value: any) => { value.caption.fontSize = Number.NaN; }],
    ['Infinity', (value: any) => { value.audio.bgmVolume = Number.POSITIVE_INFINITY; }],
    ['invalid animation', (value: any) => { value.image.animation = 'not-a-real-animation'; }],
    ['invalid motion', (value: any) => { value.image.motion = 'spin'; }],
    ['invalid motion strength below zero', (value: any) => { value.image.motionStrength = -0.01; }],
    ['invalid motion strength above maximum', (value: any) => { value.image.motionStrength = 2.01; }],
    ['invalid frame side', (value: any) => { value.frame.imageBorderSides = 'diagonal'; }],
    ['invalid frame width', (value: any) => { value.frame.imageBorderWidth = -1; }],
    ['invalid frame color', (value: any) => { value.frame.headerColorEnd = 'black'; }],
    ['invalid fit', (value: any) => { value.image.fit = 'stretch'; }],
    ['invalid color', (value: any) => { value.caption.color = 'yellow'; }],
    ['invalid alpha', (value: any) => { value.caption.background.alpha = 2; }],
    ['invalid catalog value', (value: any) => { value.audio.videoEffectType = '__proto__'; }],
    ['oversized string', (value: any) => { value.disclaimer.text = 'x'.repeat(65_537); }],
  ])('rejects %s before storage', (_name, mutate) => {
    const value = structuredClone(draftTemplates[0]) as any;
    mutate(value);
    expect(() => parseDraftTemplate(value)).toThrow();
  });

  it('accepts zero image height and camera strength as intentional disabled states', () => {
    const value = structuredClone(draftTemplates[0]);
    value.image.height = 0;
    value.image.motionStrength = 0;
    expect(parseDraftTemplate(value).image).toMatchObject({ height: 0, motionStrength: 0 });
  });

  it('rejects prototype-pollution keys at nested boundaries', () => {
    const value = JSON.parse(JSON.stringify(draftTemplates[0]));
    value.caption.background = JSON.parse('{"color":"#000000","alpha":0.5,"roundRadius":0.3,"__proto__":{"polluted":true}}');
    expect(() => parseDraftTemplate(value)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
