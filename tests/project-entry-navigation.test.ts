import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceNavigationController } from '../src/shared/workspace-navigation';
import { taskWorkspaceView, workspaceReturnViewForNavigation } from '../src/app/navigation';

// Execute the production App closures with controlled React state and the real leave guard.
// AST extraction keeps this test independent of desktop bootstrap/licensing and runs behavior,
// including whichever implementation is actually wired to AppShell and AppRoutes.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'AppWorkspace')!;
const names = ['navigate', 'navigateFromShell', 'navigateNow', 'openTaskDetailNow'];
const functions = workspace.body!.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name!.text)).map((node) => node.getText(source)).join('\n');
function wiredNavigate(tag: string) {
  let result = '';
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) {
      const attr = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === 'navigate') as ts.JsxAttribute;
      result = (attr.initializer as ts.JsxExpression).expression!.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(workspace);
  return result;
}
function harness(initial = 'new-task') {
  const values: Record<string, any> = { activeView: initial, taskDetailReturnView: 'projects', requestedMotionComicTaskId: 'old', newProjectEntryRevision: 0 };
  const navigation = createWorkspaceNavigationController();
  const persist = vi.fn();
  const context: Record<string, any> = {
    navigation, activeViewRef: { current: initial }, startTransition: (run: () => void) => run(),
    selectedTaskIdRef: { current: null }, activeHtmlTaskIdRef: { current: null },
    workspaceReturnViewForNavigation, taskWorkspaceView,
    state: { tasks: [{ id: 'comic-42', taskType: 'motion-comic' }] },
    shellAction: { run: async (run: () => unknown) => ({ ok: true, value: await run() }) },
    api: { saveUiPreferences: vi.fn(async () => null) }, applyState: vi.fn(), persistActiveViewPreference: persist,
  };
  for (const key of ['activeView', 'taskDetailReturnView', 'requestedMotionComicTaskId', 'requestedEditorialCollageTaskId', 'requestedHtmlTaskId', 'selectedTaskId', 'newProjectEntryRevision', 'projectFilterRequest', 'saveTone']) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (update: any) => { values[key] = typeof update === 'function' ? update(values[key]) : update; };
  }
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function(...Object.keys(context), `${compiled}; return { shell: ${wiredNavigate('AppShell')}, route: ${wiredNavigate('AppRoutes')}, openTaskDetailNow };`)(...Object.values(context));
  return { ...run, values, navigation, persist };
}

describe('unified project entry production navigation', () => {
  it.each(['new-task', 'projects', 'motion-comic'])('sidebar comic enters existing projects from %s and repeats', (from) => {
    const h = harness(from);
    h.shell('motion-comic');
    expect(h.values.activeView).toBe('projects');
    expect(h.values.projectFilterRequest).toEqual({ taskType: 'motion-comic', revision: 1 });
    h.shell('motion-comic');
    expect(h.values.projectFilterRequest.revision).toBe(2);
    h.shell('projects');
    expect(h.values.projectFilterRequest).toEqual({ taskType: 'all', revision: 3 });
  });
  it('picker navigation still enters creation without a project request', () => {
    const h = harness();
    h.route('motion-comic');
    expect(h.values.activeView).toBe('motion-comic');
    expect(h.values.requestedMotionComicTaskId).toBe('');
    expect(h.values.projectFilterRequest).toBeUndefined();
  });
  it('cancel keeps the editor, task ID and filter; confirmed discard applies together', async () => {
    const h = harness('motion-comic');
    h.navigation.register('editor', () => ({ id: 'editor', label: 'editor', dirty: true, onDiscard: vi.fn() }));
    h.shell('motion-comic');
    expect(h.values.activeView).toBe('motion-comic');
    expect(h.values.projectFilterRequest).toBeUndefined();
    h.navigation.cancel();
    expect(h.values.requestedMotionComicTaskId).toBe('old');
    h.shell('motion-comic');
    await h.navigation.confirm('discard');
    expect(h.values.activeView).toBe('projects');
    expect(h.values.projectFilterRequest.revision).toBe(1);
  });
  it('opening an existing task retains the precise task ID and original workspace route', async () => {
    const h = harness('projects');
    await h.openTaskDetailNow('comic-42', 'projects');
    expect(h.values.activeView).toBe('motion-comic');
    expect(h.values.requestedMotionComicTaskId).toBe('comic-42');
    expect(h.values.taskDetailReturnView).toBe('projects');
    expect(h.values.projectFilterRequest).toBeUndefined();
  });
});
