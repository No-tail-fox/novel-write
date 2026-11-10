// Small helpers for asserting on react-dom/server markup instead of component source text.

/** Every rendered `<button>…</button>` element, outer HTML. */
export function markupButtons(markup: string): string[] {
  return markup.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/gu) ?? [];
}

/** The opening tag of an element's outer HTML (attributes only). */
export function openingTag(element: string): string {
  return element.slice(0, element.indexOf('>') + 1);
}

/** Visible text with tags removed and whitespace collapsed. */
export function markupText(markup: string): string {
  return markup.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Opening tag of the form control associated with a Fluent field label (`<label for=…>label</label>`). */
export function fieldControl(markup: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const id = markup.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${escaped}</label>`, 'u'))?.[1];
  if (!id) return undefined;
  return markup.match(new RegExp(`<(?:input|textarea|select)\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"[^>]*>`, 'u'))?.[0];
}

/** Text content of the element with the given class (first match, nesting-unaware; use for leaf-ish nodes). */
export function elementWithClass(markup: string, className: string, tag = '[a-z]+'): string | undefined {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return markup.match(new RegExp(`<(${tag})\\b[^>]*class="(?:[^"]*\\s)?${escaped}(?:\\s[^"]*)?"[^>]*>[\\s\\S]*?</\\1>`, 'u'))?.[0];
}
