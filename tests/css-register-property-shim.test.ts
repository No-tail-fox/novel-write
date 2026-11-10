import { describe, expect, it } from 'vitest';
import { CSS_REGISTER_PROPERTY_SHIM } from '../src/shared/css-register-property-shim';
import { buildVoxAnimationHtml } from '../src/shared/vox-animation';

function installShim() {
  const registered = new Set<string>();
  const css = { registerProperty(d: { name: string }) {
    if (d.name === '--broken') throw new SyntaxError('bad syntax');
    if (registered.has(d.name)) throw Object.assign(new Error('already registered'), { name: 'InvalidModificationError' });
    registered.add(d.name);
  } };
  const window = { CSS: css };
  new Function('window', CSS_REGISTER_PROPERTY_SHIM)(window);
  new Function('window', CSS_REGISTER_PROPERTY_SHIM)(window); // installing twice stays a single wrapper
  return { css: window.CSS, registered };
}

describe('CSS.registerProperty shim (T-2)', () => {
  it('makes duplicate registration idempotent and keeps other errors', () => {
    const { css, registered } = installShim();
    css.registerProperty({ name: '--angle' });
    expect(() => css.registerProperty({ name: '--angle' })).not.toThrow();
    expect([...registered]).toEqual(['--angle']);
    expect(() => css.registerProperty({ name: '--broken' })).toThrow('bad syntax');
  });
  it('runs before AI-authored scene code in VOX previews', () => {
    const payload = { animation: { mode: 'code', code: { engine: 'vox', compiled: 'CSS.registerProperty({name:"--a",syntax:"<angle>",inherits:false,initialValue:"0deg"});' } }, assets: [] } as never;
    const html = buildVoxAnimationHtml('/* runtime */', payload);
    expect(html.indexOf('__sdIdempotent')).toBeGreaterThan(-1);
    expect(html.indexOf('__sdIdempotent')).toBeLessThan(html.indexOf('--a'));
  });
});
