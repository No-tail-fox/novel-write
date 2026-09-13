import { describe, expect, it } from 'vitest';
import { createDirectorRequestGate } from '../src/features/director-desk/director-request-gate';

describe('director request gate', () => {
  it('accepts one request per stable shot/cue key until completion', () => {
    const gate = createDirectorRequestGate();
    expect(gate.begin('shot-1')).toBe(true);
    expect(gate.begin('shot-1')).toBe(false);
    expect(gate.has('shot-1')).toBe(true);
    gate.end('shot-1');
    expect(gate.begin('shot-1')).toBe(true);
  });

  it('keeps different capabilities and cues independent and clears on navigation', () => {
    const gate = createDirectorRequestGate();
    expect(gate.begin('shot-1:image')).toBe(true);
    expect(gate.begin('shot-1:cue-1')).toBe(true);
    expect(gate.begin('shot-1:video')).toBe(true);
    gate.clear();
    expect(gate.has('shot-1:image')).toBe(false);
    expect(gate.begin('shot-1:image')).toBe(true);
  });
});
