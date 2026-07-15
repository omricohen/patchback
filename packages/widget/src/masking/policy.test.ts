import { describe, expect, it } from 'vitest';

import { createMaskingEngine } from './engine.js';
import { MaskingConfigError, resolveMaskingConfig } from './policy.js';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function el(selector: string): Element {
  const found = document.querySelector(selector);
  if (found === null) {
    throw new Error(`test fixture missing ${selector}`);
  }
  return found;
}

describe('masking policy matrix', () => {
  it('masks form-field values by default (maskInputs: true)', () => {
    mount(
      '<input id="t" type="text"><textarea id="a"></textarea>' +
        '<select id="s"></select><div id="e" contenteditable="true"></div>' +
        '<p id="p">static text</p>',
    );
    const engine = createMaskingEngine();
    expect(engine.classify(el('#t'))).toBe('masked');
    expect(engine.classify(el('#a'))).toBe('masked');
    expect(engine.classify(el('#s'))).toBe('masked');
    expect(engine.classify(el('#e'))).toBe('masked');
    // Static text is NOT masked by maskInputs — that's maskSelectors' job.
    expect(engine.classify(el('#p'))).toBe('visible');
  });

  it('maskInputs: false unmasks ordinary fields but NEVER the hard floor', () => {
    mount(
      '<input id="text" type="text">' +
        '<input id="pw" type="password">' +
        '<input id="hidden" type="hidden">' +
        '<input id="cc" autocomplete="cc-number">' +
        '<input id="csc" autocomplete="cc-csc">' +
        '<input id="exp" autocomplete="cc-exp">' +
        '<input id="expm" autocomplete="cc-exp-month">' +
        '<input id="otp" autocomplete="one-time-code">' +
        '<input id="cur" autocomplete="current-password">' +
        '<input id="new" autocomplete="new-password">' +
        '<input id="multi" autocomplete="shipping cc-number">',
    );
    const engine = createMaskingEngine({ maskInputs: false });
    expect(engine.classify(el('#text'))).toBe('visible');
    // Each hard-floor member pinned individually:
    expect(engine.classify(el('#pw'))).toBe('masked');
    expect(engine.classify(el('#hidden'))).toBe('masked');
    expect(engine.classify(el('#cc'))).toBe('masked');
    expect(engine.classify(el('#csc'))).toBe('masked');
    expect(engine.classify(el('#exp'))).toBe('masked');
    expect(engine.classify(el('#expm'))).toBe('masked');
    expect(engine.classify(el('#otp'))).toBe('masked');
    expect(engine.classify(el('#cur'))).toBe('masked');
    expect(engine.classify(el('#new'))).toBe('masked');
    expect(engine.classify(el('#multi'))).toBe('masked');
  });

  it('the hard floor cannot be reached by unmaskSelectors or data-patchback-unmask', () => {
    mount(
      '<input id="pw" type="password" data-patchback-unmask>' +
        '<input id="cc" class="show-me" autocomplete="cc-number">',
    );
    const engine = createMaskingEngine({
      maskInputs: false,
      unmaskSelectors: ['.show-me', '#pw'],
    });
    expect(engine.classify(el('#pw'))).toBe('masked');
    expect(engine.classify(el('#cc'))).toBe('masked');
  });

  it('unmask opts a specific field back in (nearest marker wins)', () => {
    mount(
      '<div data-patchback-mask id="zone">' +
        '  <span id="inzone">secret text</span>' +
        '  <div data-patchback-unmask><span id="shown">fine</span></div>' +
        '</div>' +
        '<input id="plain" type="text" data-patchback-unmask>',
    );
    const engine = createMaskingEngine();
    expect(engine.classify(el('#inzone'))).toBe('masked');
    expect(engine.classify(el('#shown'))).toBe('visible');
    // Unmask beats the maskInputs default on an ordinary input.
    expect(engine.classify(el('#plain'))).toBe('visible');
  });

  it('a node carrying BOTH mask and unmask resolves to mask', () => {
    mount('<div data-patchback-mask data-patchback-unmask id="both">x</div>');
    const engine = createMaskingEngine();
    expect(engine.classify(el('#both'))).toBe('masked');
  });

  it('nearest-marker resolution: inner unmask inside masked inside unmasked', () => {
    mount(
      '<div data-patchback-unmask>' +
        '  <div data-patchback-mask>' +
        '    <span id="masked-span">a</span>' +
        '    <div data-patchback-unmask><span id="visible-span">b</span></div>' +
        '  </div>' +
        '</div>',
    );
    const engine = createMaskingEngine();
    expect(engine.classify(el('#masked-span'))).toBe('masked');
    expect(engine.classify(el('#visible-span'))).toBe('visible');
  });

  it('ignore beats everything on its subtree, including unmask', () => {
    mount(
      '<div data-patchback-ignore id="card">' +
        '  <div data-patchback-unmask><span id="deep">still gone</span></div>' +
        '</div>',
    );
    const engine = createMaskingEngine();
    expect(engine.classify(el('#card'))).toBe('ignored');
    expect(engine.classify(el('#deep'))).toBe('ignored');
  });

  it('config selectors work like the markup attributes', () => {
    mount(
      '<div class="pii"><span id="m">x</span></div>' +
        '<aside class="debug-panel"><span id="i">y</span></aside>',
    );
    const engine = createMaskingEngine({
      maskSelectors: ['.pii'],
      ignoreSelectors: ['.debug-panel'],
    });
    expect(engine.classify(el('#m'))).toBe('masked');
    expect(engine.classify(el('#i'))).toBe('ignored');
  });

  it('policy crosses OPEN shadow boundaries (marker on the host governs)', () => {
    mount('<div id="host" data-patchback-mask></div>');
    const host = el('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'inside';
    shadow.appendChild(inner);
    const engine = createMaskingEngine();
    expect(engine.classify(inner)).toBe('masked');
  });

  it('cross-origin iframes are always ignored (fail closed)', () => {
    mount('<iframe id="xo"></iframe>');
    const iframe = el('#xo') as HTMLIFrameElement;
    // Simulate cross-origin: contentDocument is null.
    Object.defineProperty(iframe, 'contentDocument', { value: null });
    const engine = createMaskingEngine();
    expect(engine.classify(iframe)).toBe('ignored');
  });

  it('throws loudly at init on invalid selectors', () => {
    expect(() =>
      createMaskingEngine({ maskSelectors: ['<<<not a selector'] }),
    ).toThrow(MaskingConfigError);
    expect(() => createMaskingEngine({ ignoreSelectors: [''] })).toThrow(
      MaskingConfigError,
    );
    expect(() => resolveMaskingConfig({ unmaskSelectors: [':::'] })).toThrow(
      MaskingConfigError,
    );
  });

  it('maskedTextOf: masked replaced, ignored dropped, input values never present', () => {
    mount(
      '<section id="root">' +
        '  <h2>Order details</h2>' +
        '  <span data-patchback-mask>SENTINEL-customer-name</span>' +
        '  <div data-patchback-ignore>SENTINEL-internal-note</div>' +
        '  <input type="text" value="SENTINEL-typed-value">' +
        '  <p>visible copy</p>' +
        '</section>',
    );
    const engine = createMaskingEngine();
    const text = engine.maskedTextOf(el('#root'));
    expect(text).toContain('Order details');
    expect(text).toContain('visible copy');
    expect(text).toContain('[masked]');
    expect(text).not.toContain('SENTINEL');
  });

  it('maskedTextOf scrubs captured text (emails) unless scrubText: false', () => {
    mount('<p id="p">contact someone@example.com now</p>');
    expect(createMaskingEngine().maskedTextOf(el('#p'))).toBe(
      'contact [email] now',
    );
    expect(
      createMaskingEngine({ scrubText: false }).maskedTextOf(el('#p')),
    ).toContain('someone@example.com');
  });
});
