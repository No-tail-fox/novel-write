import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Execute the production handler, not a copied implementation. Inject only its component closure. */
export function sourceText(path: string): string {
  return readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
}
export function handlerSource(path: string, name: string): string {
  const file = ts.createSourceFile(path, sourceText(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) throw new Error(`${path}#${name}: expected one handler, found ${matches.length}`);
  return matches[0].getText(file);
}
export function productionHandler(path: string, name: string, closure: Record<string, unknown>) {
  const javascript = ts.transpileModule(handlerSource(path, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(closure), `${javascript}\nreturn ${name};`)(...Object.values(closure)) as (...args: any[]) => Promise<any>;
}
export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
