import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function versionExpression(node: ts.Node, bindings: Record<string, string>): string {
  if (ts.isJsxText(node)) return node.getText().trim();
  if (ts.isJsxExpression(node) && node.expression) return versionExpression(node.expression, bindings);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && Object.hasOwn(bindings, node.text)) return bindings[node.text];
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => versionExpression(span.expression, bindings) + span.literal.text).join('');
  throw new Error('Unrecognized visible-version expression: ' + node.getText());
}

function findNode<T extends ts.Node>(source: ts.SourceFile, predicate: (node: ts.Node) => node is T): T {
  let result: T | undefined;
  function visit(node: ts.Node) { if (predicate(node)) result = node; else ts.forEachChild(node, visit); }
  visit(source);
  if (!result) throw new Error('Visible release-version element is missing');
  return result;
}

function attribute(properties: ts.JsxAttributes, name: string) {
  return properties.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name)?.initializer;
}

describe('application version', () => {
  it('keeps both visible release versions aligned with the package and lockfile', async () => {
    const [packageSource, lockSource, shellSource, settingsSource] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8'),
    ]);
    const packageVersion = (JSON.parse(packageSource) as { version: string }).version;
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(lockSource);
    expect(lock.version).toBe(packageVersion);
    expect(lock.packages[''].version).toBe(packageVersion);
    const visible: string[] = [];
    for (const [fileName, text, relativePath] of [
      ['AppShell.tsx', shellSource, '../src/app/AppShell.tsx'],
      ['SettingsPage.tsx', settingsSource, '../src/features/settings/SettingsPage.tsx'],
    ]) {
      const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const bindings: Record<string, string> = {};
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.endsWith('/package.json')) continue;
        expect(new URL(statement.moduleSpecifier.text, new URL(relativePath, import.meta.url)).href).toBe(new URL('../package.json', import.meta.url).href);
        const names = statement.importClause?.namedBindings;
        if (names && ts.isNamedImports(names)) for (const binding of names.elements) {
          if ((binding.propertyName?.text ?? binding.name.text) === 'version') bindings[binding.name.text] = packageVersion;
        }
      }
      if (fileName === 'AppShell.tsx') {
        const element = findNode(source, (node): node is ts.JsxElement => ts.isJsxElement(node)
          && node.openingElement.tagName.getText() === 'span'
          && attribute(node.openingElement.attributes, 'className')?.getText() === '"window-version"');
        visible.push(element.children.map(child => versionExpression(child, bindings)).join(''));
      } else {
        const element = findNode(source, (node): node is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(node)
          && node.tagName.getText() === 'LocalInfo'
          && attribute(node.attributes, 'title')?.getText() === '"视频故事创作助手"');
        visible.push(versionExpression(attribute(element.attributes, 'value')!, bindings));
      }
    }
    expect(visible[0]).toBe('V' + packageVersion);
    expect(visible[1]).toBe('V' + packageVersion + ' · Windows · 本地数据目录');
  });
});
