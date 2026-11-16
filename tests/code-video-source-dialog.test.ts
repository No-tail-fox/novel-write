import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../src/features/editorial-collage/CodeVideoSourceDialog.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('CodeVideoSourceDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string): string {
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!result) throw new Error(`Missing handler: ${name}`);
  return result;
}

describe('code video source preparation commands', () => {
  it('binds explicit AI condensation to the project and retains review before production', () => {
    const body = handler('condense');
    expect(body).toContain('action.run(');
    expect(body).toContain('api.composeResearchCopy({ projectId: document.id');
    expect(body).toContain('targetDurationSeconds: policy.targetDurationSeconds');
    expect(body).toContain('setProposal(result.copy)');
    expect(source).toContain('disabled={action.busy || creationStarted} onClick={() => void condense()}');
    expect(source).toContain('请求 AI 精简');
    expect(body).not.toMatch(/api\.(?:startVoxProduction|generateVoiceLabPreview)\(/u);
  });

  it('resumes draft configuration without recreating already-created projects', () => {
    const body = handler('createDrafts');
    expect(body).toContain('let slot = slots.current[index]');
    expect(body).toContain('if (!slot)');
    expect(body).toContain('api.createEditorialCollage(');
    expect(body.indexOf('slots.current[index] = slot')).toBeLessThan(body.indexOf('api.getTaskDetail(slot.id)'));
    expect(body).toContain('if (!slot.configured)');
    expect(body).toContain('api.saveEditorialCollage({ id: slot.id, expectedUpdatedAt: created.updatedAt, document: configured })');
    expect(body.indexOf('api.saveEditorialCollage(')).toBeLessThan(body.indexOf('slot.configured = true'));
    expect(body).toContain('lockedShotIds: []');
    expect(body).not.toContain('api.startVoxProduction(');
  });

  it('blocks incomplete proposals and busy actions while exposing retryable failures', () => {
    expect(source).toContain('disabled={action.busy || (condensed && (!proposalPlan || proposalPlan.requiresAction))} onClick={() => void createDrafts()}');
    expect(source).toContain('保存精简稿供审核');
    expect(source).toContain('继续创建剩余草稿');
    expect(source).toContain('action.feedback && <p role="alert">{action.feedback.message}');
    expect(source).toContain('已创建的草稿保留');
    expect(source).toContain('if (!open && !action.busy) onClose()');
  });
});
