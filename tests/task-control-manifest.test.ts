import { describe, expect, it } from 'vitest';
import { NEW_TASK_CREATE_FIELD_STAGE } from '../src/features/tasks/task-control-manifest';
import { approvedEditorialInventories } from './fixtures/editorial-workbench-parity';

describe('new task field ownership manifest', () => {
  it('assigns every approved CreateTaskInput field to exactly one stage owner', () => {
    const ownedFields = Object.keys(NEW_TASK_CREATE_FIELD_STAGE);
    const approvedFields = approvedEditorialInventories.createTaskInputFields.values;
    expect(new Set(ownedFields).size).toBe(ownedFields.length);
    expect([...ownedFields].sort()).toEqual([...approvedFields].sort());
    expect(Object.values(NEW_TASK_CREATE_FIELD_STAGE).every((stage) => (
      stage === 'material' || stage === 'creative' || stage === 'output' || stage === 'system'
    ))).toBe(true);
  });
});
