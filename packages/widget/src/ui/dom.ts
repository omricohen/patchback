/** Tiny DOM construction helper — no framework, no innerHTML for content. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: Array<Node | string | undefined> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (name === 'className') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (child === undefined) {
      continue;
    }
    el.append(child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}
