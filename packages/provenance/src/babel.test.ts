import { transformAsync } from '@babel/core';
import { describe, expect, it } from 'vitest';

import provenancePlugin, { INTERACTIVE_TAGS } from './babel.js';

const ROOT = '/repo';

async function transform(
  code: string,
  filename: string,
  options: Record<string, unknown> = { root: ROOT },
): Promise<string> {
  const result = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[provenancePlugin, options]],
  });
  return result?.code ?? '';
}

describe('babel plugin (static annotation)', () => {
  it('stamps host elements with repo-relative file:line', async () => {
    const code = [
      'export function App() {',
      '  return <div id="a"><button>Go</button></div>;',
      '}',
    ].join('\n');
    const out = await transform(code, `${ROOT}/src/App.tsx`);
    expect(out).toContain('data-pb-source="src/App.tsx:2"');
    // Both div and button live on line 2.
    expect(out.match(/data-pb-source/g)).toHaveLength(2);
  });

  it('does not stamp components or member-expression elements', async () => {
    const code = [
      'declare const Foo: any;',
      'export const x = <Foo.Bar><Widget /></Foo.Bar>;',
      'declare const Widget: any;',
    ].join('\n');
    const out = await transform(code, `${ROOT}/src/x.tsx`);
    expect(out).not.toContain('data-pb-source');
  });

  it('elements: "interactive" stamps only the static interactive tag list', async () => {
    const code = [
      'export const x = (',
      '  <div>',
      '    <button>b</button>',
      '    <span>s</span>',
      '    <input />',
      '  </div>',
      ');',
    ].join('\n');
    const out = await transform(code, `${ROOT}/src/x.tsx`, {
      root: ROOT,
      elements: 'interactive',
    });
    expect(out).toContain('data-pb-source="src/x.tsx:3"'); // button
    expect(out).toContain('data-pb-source="src/x.tsx:5"'); // input
    expect(out.match(/data-pb-source/g)).toHaveLength(2); // not div/span
    expect(INTERACTIVE_TAGS.has('button')).toBe(true);
    expect(INTERACTIVE_TAGS.has('div')).toBe(false);
  });

  it('a manually authored attribute wins', async () => {
    const code =
      'export const x = <div data-pb-source="src/manual.tsx:9">m</div>;';
    const out = await transform(code, `${ROOT}/src/x.tsx`);
    expect(out).toContain('data-pb-source="src/manual.tsx:9"');
    expect(out.match(/data-pb-source/g)).toHaveLength(1);
  });

  it('file outside the root ⇒ untouched (fail closed)', async () => {
    const code = 'export const x = <div>d</div>;';
    const out = await transform(code, '/elsewhere/x.tsx');
    expect(out).not.toContain('data-pb-source');
  });

  it('never emits an absolute path even for deep monorepo files', async () => {
    const code = 'export const x = <button>b</button>;';
    const out = await transform(
      code,
      `${ROOT}/apps/web/src/pages/settings.tsx`,
    );
    expect(out).toContain('data-pb-source="apps/web/src/pages/settings.tsx:1"');
    expect(out).not.toContain(`"${ROOT}/`);
  });

  it('keeps JSX intact (no runtime transform applied)', async () => {
    const code = 'export const x = <div>d</div>;';
    const out = await transform(code, `${ROOT}/src/x.tsx`);
    expect(out).toContain('<div');
    expect(out).not.toContain('jsx(');
  });
});
