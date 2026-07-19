import { afterEach, describe, expect, it } from 'vitest';

import { PROVENANCE_ATTRIBUTE } from '@patchback/types';
import * as ReactJSXDevRuntime from 'react/jsx-dev-runtime';
import * as ReactJSXRuntime from 'react/jsx-runtime';

import { setProvenanceRoot } from './core.js';
import { Fragment, jsxDEV } from './jsx-dev-runtime.js';
import * as prodRuntime from './jsx-runtime.js';

const ROOT = '/home/dev/project';
const SOURCE = {
  fileName: `${ROOT}/src/App.tsx`,
  lineNumber: 42,
  columnNumber: 5,
};

interface ElementLike {
  type: unknown;
  props: Record<string, unknown>;
}

afterEach(() => {
  setProvenanceRoot(undefined);
});

describe('jsxDEV wrapper', () => {
  it('stamps host elements with the repo-relative file:line', () => {
    setProvenanceRoot(ROOT);
    const el = jsxDEV(
      'button',
      { id: 'x' },
      undefined,
      false,
      SOURCE,
      undefined,
    ) as ElementLike;
    expect(el.type).toBe('button');
    expect(el.props[PROVENANCE_ATTRIBUTE]).toBe('src/App.tsx:42');
    expect(el.props.id).toBe('x');
  });

  it('does NOT stamp component elements', () => {
    setProvenanceRoot(ROOT);
    function MyComponent(): null {
      return null;
    }
    const el = jsxDEV(
      MyComponent,
      {},
      undefined,
      false,
      SOURCE,
      undefined,
    ) as ElementLike;
    expect(el.props[PROVENANCE_ATTRIBUTE]).toBeUndefined();
  });

  it('a manually authored attribute wins over the runtime stamp', () => {
    setProvenanceRoot(ROOT);
    const el = jsxDEV(
      'div',
      { [PROVENANCE_ATTRIBUTE]: 'src/manual.tsx:7' },
      undefined,
      false,
      SOURCE,
      undefined,
    ) as ElementLike;
    expect(el.props[PROVENANCE_ATTRIBUTE]).toBe('src/manual.tsx:7');
  });

  it('no injected root ⇒ no stamp (fail closed)', () => {
    const el = jsxDEV(
      'div',
      {},
      undefined,
      false,
      SOURCE,
      undefined,
    ) as ElementLike;
    expect(PROVENANCE_ATTRIBUTE in el.props).toBe(false);
  });

  it('no source argument ⇒ no stamp, still renders', () => {
    setProvenanceRoot(ROOT);
    const el = jsxDEV(
      'div',
      { id: 'y' },
      undefined,
      false,
      undefined,
      undefined,
    ) as ElementLike;
    expect(PROVENANCE_ATTRIBUTE in el.props).toBe(false);
    expect(el.props.id).toBe('y');
  });

  it('node_modules fileName ⇒ no stamp', () => {
    setProvenanceRoot(ROOT);
    const el = jsxDEV(
      'div',
      {},
      undefined,
      false,
      { fileName: `${ROOT}/node_modules/lib/x.js`, lineNumber: 1 },
      undefined,
    ) as ElementLike;
    expect(PROVENANCE_ATTRIBUTE in el.props).toBe(false);
  });

  it('the stamped value never contains an absolute path', () => {
    setProvenanceRoot(ROOT);
    const el = jsxDEV(
      'span',
      {},
      undefined,
      false,
      SOURCE,
      undefined,
    ) as ElementLike;
    const stamp = el.props[PROVENANCE_ATTRIBUTE] as string;
    expect(stamp.includes(ROOT)).toBe(false);
    expect(stamp.startsWith('/')).toBe(false);
  });

  it('does not mutate the caller-supplied props object', () => {
    setProvenanceRoot(ROOT);
    const props = { id: 'x' };
    jsxDEV('button', props, undefined, false, SOURCE, undefined);
    expect(PROVENANCE_ATTRIBUTE in props).toBe(false);
  });

  it('re-exports React Fragment', () => {
    expect(Fragment).toBe(ReactJSXDevRuntime.Fragment);
  });
});

describe('jsx-runtime prod entry', () => {
  it('is a PURE passthrough of React jsx-runtime (structural stripping)', () => {
    expect(prodRuntime.jsx).toBe(ReactJSXRuntime.jsx);
    expect(prodRuntime.jsxs).toBe(ReactJSXRuntime.jsxs);
    expect(prodRuntime.Fragment).toBe(ReactJSXRuntime.Fragment);
  });
});
