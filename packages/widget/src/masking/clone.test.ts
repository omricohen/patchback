import { describe, expect, it } from 'vitest';

import { createMaskingEngine } from './engine.js';

/**
 * Screenshot redaction LAYER 1 (clone-stage, semantic): after
 * `applyToClone`, the serialized clone contains no sentinel — masked
 * content never exists in what gets rasterized.
 */
describe('applyMaskingToClone (screenshot layer 1)', () => {
  it('strips masked input values — attribute AND live property', () => {
    document.body.innerHTML =
      '<div id="page">' +
      '  <input id="name" type="text" value="SENTINEL-attr">' +
      '  <input id="pw" type="password">' +
      '  <textarea id="notes">SENTINEL-textarea</textarea>' +
      '  <select id="pick"><option selected>SENTINEL-option</option></select>' +
      '  <div id="editor" contenteditable="true">SENTINEL-editable</div>' +
      '</div>';
    // Live (user-typed) values are properties, not attributes; renderers
    // sync them into the clone — simulate that worst case.
    const pw = document.querySelector('#pw') as HTMLInputElement;
    pw.value = 'SENTINEL-hunter2';
    pw.setAttribute('value', 'SENTINEL-hunter2');

    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);

    const html = clone.outerHTML;
    expect(html).not.toContain('SENTINEL');
    expect((clone.querySelector('#pw') as HTMLInputElement).value).toBe('');
    expect((clone.querySelector('#name') as HTMLInputElement).value).toBe('');
  });

  it('replaces masked element text with same-length filler (geometry preserved)', () => {
    document.body.innerHTML =
      '<div id="page"><span data-patchback-mask id="s">SENTINEL-42</span></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    const text = clone.querySelector('#s')?.textContent ?? '';
    expect(text).not.toContain('SENTINEL');
    expect(text).toHaveLength('SENTINEL-42'.length);
    expect(text).toMatch(/^•+$/);
  });

  it('empties ignored subtrees entirely', () => {
    document.body.innerHTML =
      '<div id="page">' +
      '  <aside data-patchback-ignore id="card">' +
      '    <h3>SENTINEL-heading</h3><input value="SENTINEL-value">' +
      '  </aside>' +
      '  <p>kept copy</p>' +
      '</div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
    expect(clone.querySelector('#card')?.childNodes).toHaveLength(0);
    expect(clone.outerHTML).toContain('kept copy');
  });

  it('keeps unmasked descendants of a masked container intact', () => {
    document.body.innerHTML =
      '<div id="page"><div data-patchback-mask>SECRET-text' +
      '<span data-patchback-unmask id="ok">public label</span></div></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SECRET-text');
    expect(clone.querySelector('#ok')?.textContent).toBe('public label');
  });

  it('strips values of inputs nested inside a masked container', () => {
    document.body.innerHTML =
      '<div id="page"><form data-patchback-mask>' +
      '<input value="SENTINEL-nested"></form></div>';
    const engine = createMaskingEngine({ maskInputs: false });
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
  });

  it('leaves unmasked content untouched when masking is relaxed', () => {
    document.body.innerHTML =
      '<div id="page"><input id="i" type="text" value="fine-to-show"><p>copy</p></div>';
    const engine = createMaskingEngine({ maskInputs: false });
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).toContain('fine-to-show');
    expect(clone.outerHTML).toContain('copy');
  });

  it('strips img/source media inside masked subtrees — src, srcset, lazy attrs', () => {
    document.body.innerHTML =
      '<div id="page"><div data-patchback-mask>' +
      '<img id="i" src="/SENTINEL-photo.png" srcset="/SENTINEL-photo@2x.png 2x" data-src="/SENTINEL-lazy.png">' +
      '<picture><source srcset="/SENTINEL-source.webp"><img src="/SENTINEL-pic.png"></picture>' +
      '</div></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
    expect(clone.querySelector('#i')?.getAttribute('src')).toBeNull();
    expect(clone.querySelector('source')?.getAttribute('srcset')).toBeNull();
  });

  it("strips an ignored element's OWN media and background — not just its children", () => {
    document.body.innerHTML =
      '<div id="page">' +
      '<img data-patchback-ignore id="lone" src="/SENTINEL-avatar.png">' +
      '<div data-patchback-ignore id="bg" style="background-image: url(/SENTINEL-bg.png)">x</div>' +
      '</div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
    const bg = clone.querySelector('#bg') as HTMLElement;
    expect(bg.style.getPropertyValue('background-image')).toBe('none');
    expect(bg.style.getPropertyPriority('background-image')).toBe('important');
  });

  it('neutralizes background/border/mask image sources on masked elements with !important', () => {
    document.body.innerHTML =
      '<div id="page"><div data-patchback-mask id="m" ' +
      'style="background-image: url(/SENTINEL-bg.png); border-image-source: url(/SENTINEL-border.png)">' +
      'text</div></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
    const m = clone.querySelector('#m') as HTMLElement;
    expect(m.style.getPropertyValue('background-image')).toBe('none');
    expect(m.style.getPropertyPriority('background-image')).toBe('important');
    expect(m.style.getPropertyValue('border-image-source')).toBe('none');
  });

  it('empties svg and strips video/audio sources inside masked subtrees', () => {
    document.body.innerHTML =
      '<div id="page"><section data-patchback-mask>' +
      '<svg viewBox="0 0 10 10"><text>SENTINEL-svg</text><rect width="10" height="10"></rect></svg>' +
      '<video src="/SENTINEL-video.mp4" poster="/SENTINEL-poster.png">' +
      '<source src="/SENTINEL-inner.mp4"></video>' +
      '</section></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('SENTINEL');
    expect(clone.querySelector('svg')?.childNodes).toHaveLength(0);
    expect(clone.querySelector('video')?.getAttribute('src')).toBeNull();
    expect(clone.querySelector('video')?.getAttribute('poster')).toBeNull();
  });

  it('leaves media in UNMASKED descendants of a masked container intact', () => {
    document.body.innerHTML =
      '<div id="page"><div data-patchback-mask>' +
      '<img src="/secret.png">' +
      '<div data-patchback-unmask><img id="ok" src="/public-logo.png"></div>' +
      '</div></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.outerHTML).not.toContain('secret.png');
    expect(clone.querySelector('#ok')?.getAttribute('src')).toBe(
      '/public-logo.png',
    );
  });

  it('leaves media outside masked/ignored zones untouched', () => {
    document.body.innerHTML =
      '<div id="page"><img id="hero" src="/hero.png" ' +
      'style="background-image: url(/tile.png)"><p>copy</p></div>';
    const engine = createMaskingEngine();
    const clone = (document.querySelector('#page') as Element).cloneNode(
      true,
    ) as Element;
    engine.applyToClone(clone);
    expect(clone.querySelector('#hero')?.getAttribute('src')).toBe('/hero.png');
    expect(
      (clone.querySelector('#hero') as HTMLElement).style.getPropertyValue(
        'background-image',
      ),
    ).toContain('tile.png');
  });
});
