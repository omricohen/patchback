import { describe, expect, it } from 'vitest';

import { buildDomPath, DOM_PATH_MAX_CHARS, looksGenerated } from './path.js';

describe('buildDomPath', () => {
  it('prefers a unique, stable #id', () => {
    document.body.innerHTML = '<div><button id="export-csv">x</button></div>';
    const el = document.querySelector('#export-csv') as Element;
    expect(buildDomPath(el)).toBe('#export-csv');
    expect(document.querySelector(buildDomPath(el))).toBe(el);
  });

  it('rejects generated-looking ids', () => {
    expect(looksGenerated('ember-view-129381923')).toBe(true);
    expect(looksGenerated('9f8c2b1a-0d3e-4f5a-8b6c-7d8e9f0a1b2c')).toBe(true);
    expect(looksGenerated(':r1:')).toBe(true);
    expect(looksGenerated('radix-42')).toBe(true);
    expect(looksGenerated('widget-3f9a2c7d1b')).toBe(true);
    expect(looksGenerated('export-csv')).toBe(false);
    expect(looksGenerated('order-2')).toBe(false);

    document.body.innerHTML =
      '<section><button id="btn-192837465564">x</button></section>';
    const el = document.querySelector('button') as Element;
    expect(buildDomPath(el)).not.toContain('192837465564');
  });

  it('falls back to a unique data-testid', () => {
    document.body.innerHTML =
      '<div><button data-testid="export-button">x</button></div>';
    const el = document.querySelector('button') as Element;
    expect(buildDomPath(el)).toBe('[data-testid="export-button"]');
    expect(document.querySelector(buildDomPath(el))).toBe(el);
  });

  it('builds an nth-of-type chain from the nearest stable anchor', () => {
    document.body.innerHTML = `
      <main id="orders">
        <table><tbody>
          <tr><td>a</td><td><button>one</button></td></tr>
          <tr><td>b</td><td><button>two</button></td></tr>
        </tbody></table>
      </main>`;
    const buttons = document.querySelectorAll('button');
    const second = buttons[1] as Element;
    const path = buildDomPath(second);
    expect(path.startsWith('#orders')).toBe(true);
    expect(path).toContain('tr:nth-of-type(2)');
    expect(document.querySelector(path)).toBe(second);
  });

  it('resolves uniquely among many siblings without ids', () => {
    document.body.innerHTML =
      '<ul>' +
      Array.from({ length: 5 }, (_, i) => `<li><span>${i}</span></li>`).join(
        '',
      ) +
      '</ul>';
    const third = document.querySelectorAll('li span')[2] as Element;
    const path = buildDomPath(third);
    expect(document.querySelector(path)).toBe(third);
  });

  it('caps the path at the schema limit', () => {
    // Deeply nested structure with no stable anchors.
    let html = '<div>'.repeat(400) + '<button>x</button>' + '</div>'.repeat(400);
    document.body.innerHTML = html;
    const el = document.querySelector('button') as Element;
    expect(buildDomPath(el).length).toBeLessThanOrEqual(DOM_PATH_MAX_CHARS);
  });

  it('skips non-unique ids', () => {
    document.body.innerHTML =
      '<div id="dup"><span>a</span></div><div id="dup"><span id="t">b</span></div>';
    const el = document.querySelector('#t') as Element;
    // #t is unique → used; but the duplicate #dup must never be an anchor.
    expect(buildDomPath(el)).toBe('#t');
    document.body.innerHTML =
      '<div id="dup"><span>a</span></div><div id="dup"><b>b</b></div>';
    const b = document.querySelector('b') as Element;
    expect(buildDomPath(b)).not.toContain('#dup');
  });
});
