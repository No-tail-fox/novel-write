import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * U-7: static accessibility contract for the renderer. Catches regressions a screen-reader / keyboard
 * pass would otherwise find late. It is a floor, not an audit: real NVDA/Narrator reading order and
 * Windows display scaling still need a manual pass (recorded in the backlog).
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Opening JSX tag starting at `start`, tolerant of `=>` and nested braces in attribute expressions. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

const files = tsxFiles('src').map(path => ({ path, source: readFileSync(path, 'utf8') }));

function tags(name: RegExp) {
  return files.flatMap(({ path, source }) => [...source.matchAll(name)].map(match => ({ path, tag: openingTag(source, match.index ?? 0) })));
}

describe('renderer accessibility contract (U-7)', () => {
  it('every <img> declares alt text (empty alt only for decorative images)', () => {
    const missing = tags(/<img\b/gu).filter(({ tag }) => !/\balt=/u.test(tag)).map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('never uses a positive tabIndex (it breaks the natural keyboard order)', () => {
    const positive = files.filter(({ source }) => /tabIndex=\{?\s*["']?[1-9]/u.test(source)).map(({ path }) => path);
    expect(positive).toEqual([]);
  });

  it('click handlers on non-interactive elements are either propagation guards or have a keyboard path', () => {
    const clickable = tags(/<(?:div|span|li|td|section|article|figure)\b(?=[^>]*\bonClick=)/gu);
    expect(clickable.length).toBeGreaterThan(3); // the scan really sees the existing rows/guards
    const offenders = clickable.filter(({ tag }) => {
      if (/onClick=\{\(event\) => event\.stopPropagation\(\)\}/u.test(tag)) return false;
      if (/\bonKeyDown=|\bonKeyUp=/u.test(tag) && /\btabIndex=/u.test(tag)) return false;
      // Table rows whose primary action is a real <Button> inside the row (mouse convenience only).
      if (/role="row"/u.test(tag) && /className="table-row clickable"/u.test(tag)) return false;
      return true;
    }).map(({ path, tag }) => `${path}: ${tag.slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it('icon-only buttons go through IconButton, which requires a label', () => {
    const iconButton = readFileSync('src/ui/IconButton.tsx', 'utf8');
    expect(iconButton).toMatch(/label: string;/u);
    expect(iconButton).toContain('aria-label={label}');
    const bareIconButtons = files.flatMap(({ path, source }) => [...source.matchAll(/<button\b([^>]*)>\s*<[A-Z]\w*[^>]*\/>\s*<\/button>/gu)]
      .filter(match => !/aria-label|title=/u.test(match[1]))
      .map(() => path));
    expect(bareIconButtons).toEqual([]);
  });

  it('keeps a visible focus ring, a forced-colors ring and a global reduced-motion fallback', () => {
    const css = readFileSync('src/styles/components.css', 'utf8');
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--shell-focus\)/u);
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.spin,\s*\.director-spin/u);
  });

  it('declares the document language for screen readers', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<html lang="zh-CN">');
  });
});
