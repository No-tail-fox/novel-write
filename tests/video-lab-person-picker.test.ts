import { describe, expect, it } from 'vitest';
import { personReferenceImage, togglePersonReference } from '../src/features/labs/video-lab-person-selection';

describe('video lab person selection', () => {
  it('preserves the selected character identity and original library file path', () => {
    expect(personReferenceImage('C:\\素材\\阿宁\\正面.png', '阿宁')).toEqual({
      path: 'C:\\素材\\阿宁\\正面.png', kind: 'character', description: '人物「阿宁」：保持人物外观、脸型和发型一致。',
    });
  });

  it('keeps images from different people and limits additions without dropping existing choices', () => {
    const first = personReferenceImage('C:/people/one/front.png', '甲');
    const second = personReferenceImage('C:/people/two/front.png', '乙');
    const third = personReferenceImage('C:/people/three/front.png', '丙');
    const selected = togglePersonReference([first], second, 2);
    expect(selected).toEqual([first, second]);
    expect(togglePersonReference(selected, third, 2)).toBe(selected);
    expect(togglePersonReference(selected, third, 0)).toBe(selected);
  });

  it('identifies a selected image by path and still allows deselection after the limit decreases', () => {
    const reference = personReferenceImage('C:/people/one/front.png', '甲');
    const other = personReferenceImage('C:/people/two/front.png', '乙');
    expect(togglePersonReference([reference, other], { ...reference, description: 'edited' }, 1)).toEqual([other]);
    expect(togglePersonReference([reference], reference, 0)).toEqual([]);
  });
});
