import { describe, expect, it } from 'vitest';
import { piLemoHostInstructions } from '../electron/pi-agent-instructions';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';

describe('Pi host instructions', () => {
  const text = piLemoHostInstructions(newCodeVideoPolicy());
  it('requires a benchmark and a statement of how the film differs from the demo', () => {
    expect(text).toContain('Benchmark section naming one reference work');
    expect(text).toContain('differs from the demo');
  });
  it('treats frame advisories as advisory and never as a visual pass without frames', () => {
    expect(text).toContain('advisory host measurements only');
    expect(text).toContain('do not mechanically edit until they disappear');
    expect(text).toContain('never describe it as a visual or aesthetic pass');
  });
  it('keeps the two-pass contact sheet review and current-evidence finish rule', () => {
    expect(text).toContain('Review full contact sheets twice');
    expect(text).toContain('call finish only with current evidence');
  });
});
