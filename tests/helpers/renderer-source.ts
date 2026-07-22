import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface RendererSources {
  all: string;
  file(path: string): string | null;
  requiredFile(path: string): string;
  reachableFrom(entryPath: string): ReadonlyMap<string, string>;
}

export async function readRendererSources(): Promise<RendererSources> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const paths = stdout
    .split('\0')
    .map(normalizeRendererPath)
    .filter((path) => /^src\/.*\.tsx?$/.test(path))
    .sort(comparePaths);
  const entries = await Promise.all(
    paths.map(async (path) => [path, await readFile(resolve(projectRoot, ...path.split('/')), 'utf8')] as const),
  );
  const sources = new Map(entries);

  return {
    all: entries.map(([, source]) => source).join('\n'),
    file(path) {
      return sources.get(normalizeRendererPath(path)) ?? null;
    },
    requiredFile(path) {
      const normalizedPath = normalizeRendererPath(path);
      const source = sources.get(normalizedPath);
      if (source === undefined) {
        throw new Error(`Required renderer source is not tracked: ${normalizedPath}`);
      }
      return source;
    },
    reachableFrom(entryPath) {
      return collectReachableSources(sources, normalizeRendererPath(entryPath));
    },
  };
}

export function collectReachableSources(sources: ReadonlyMap<string, string>, entryPath: string): ReadonlyMap<string, string> {
  const reachable = new Map<string, string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    const source = sources.get(path);
    if (source === undefined) throw new Error(`Required renderer source is not tracked: ${path}`);
    reachable.set(path, source);
    for (const specifier of staticRuntimeImports(source, path)) {
      const dependency = resolveRendererImport(sources, path, specifier);
      if (dependency && !reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

function staticRuntimeImports(source: string, path: string): string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return sourceFile.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.importClause?.isTypeOnly) return [];
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)
        && !statement.importClause?.name
        && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly)) return [];
      return [statement.moduleSpecifier.text];
    }
    if (ts.isExportDeclaration(statement)
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
      && !statement.isTypeOnly) {
      if (statement.exportClause
        && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.length > 0
        && statement.exportClause.elements.every((element) => element.isTypeOnly)) return [];
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function resolveRendererImport(sources: ReadonlyMap<string, string>, importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  else if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith('@shared/')) base = `src/shared/${specifier.slice('@shared/'.length)}`;
  else return null;
  const extension = posix.extname(base);
  const runtimeExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
  if (extension && !runtimeExtensions.has(extension)) return null;
  const extensionlessBase = extension ? base.slice(0, -extension.length) : base;
  const candidates = [...new Set([
    base,
    `${extensionlessBase}.ts`,
    `${extensionlessBase}.tsx`,
    `${extensionlessBase}.mts`,
    `${extensionlessBase}.cts`,
    `${extensionlessBase}/index.ts`,
    `${extensionlessBase}/index.tsx`,
  ])];
  for (const candidate of candidates) {
    if (sources.has(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve local renderer import '${specifier}' from ${importer}`);
}

function normalizeRendererPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
