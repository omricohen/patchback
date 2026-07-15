import { describe, expect, it } from 'vitest';

import { createMaskingEngine } from './engine.js';

/**
 * Redaction-rect collection (layer-2 geometry). jsdom reports zero-size
 * rects, so tests inject a rect provider — the real browser path is proven
 * in the env-gated acceptance suite.
 */
describe('collectRedactionRects', () => {
  function rectProvider(map: Record<string, [number, number, number, number]>) {
    return (el: Element) => {
      const hit = map[el.id];
      if (hit === undefined) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const [x, y, width, height] = hit;
      return { x, y, width, height };
    };
  }

  it('collects boxes for masked and ignored elements only', () => {
    document.body.innerHTML =
      '<input id="pw" type="password">' +
      '<div id="card" data-patchback-ignore>x</div>' +
      '<p id="copy">visible</p>';
    const engine = createMaskingEngine();
    const rects = engine.collectRedactionRects(document, {
      viewport: { width: 1000, height: 800 },
      getRect: rectProvider({
        pw: [10, 20, 200, 30],
        card: [10, 100, 300, 120],
        copy: [10, 300, 300, 20],
      }),
    });
    expect(rects).toContainEqual({ x: 10, y: 20, width: 200, height: 30 });
    expect(rects).toContainEqual({ x: 10, y: 100, width: 300, height: 120 });
    expect(rects).not.toContainEqual({ x: 10, y: 300, width: 300, height: 20 });
  });

  it('clips to the viewport and drops off-screen/zero-size boxes', () => {
    document.body.innerHTML =
      '<input id="partial" type="password">' +
      '<input id="offscreen" type="password">' +
      '<input id="zero" type="password">';
    const engine = createMaskingEngine();
    const rects = engine.collectRedactionRects(document, {
      viewport: { width: 100, height: 100 },
      getRect: rectProvider({
        partial: [80, 90, 50, 40],
        offscreen: [-500, -500, 50, 40],
        zero: [10, 10, 0, 0],
      }),
    });
    expect(rects).toEqual([{ x: 80, y: 90, width: 20, height: 10 }]);
  });

  it('descends into open shadow roots', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'shadow-pw';
    shadow.appendChild(input);
    const engine = createMaskingEngine();
    const rects = engine.collectRedactionRects(document, {
      viewport: { width: 1000, height: 1000 },
      getRect: rectProvider({ 'shadow-pw': [5, 5, 50, 20] }),
    });
    expect(rects).toEqual([{ x: 5, y: 5, width: 50, height: 20 }]);
  });
});
