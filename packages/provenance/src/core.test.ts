import { afterEach, describe, expect, it } from 'vitest';

import { computeStamp, relativeSourceFile, setProvenanceRoot } from './core.js';

const ROOT = '/home/dev/project';

afterEach(() => {
  setProvenanceRoot(undefined);
});

describe('computeStamp', () => {
  it('relativizes an absolute fileName inside the injected root', () => {
    setProvenanceRoot(ROOT);
    expect(computeStamp(`${ROOT}/src/App.tsx`, 42)).toBe('src/App.tsx:42');
    expect(computeStamp(`${ROOT}/apps/web/src/page.tsx`, 7)).toBe(
      'apps/web/src/page.tsx:7',
    );
  });

  it('fails closed with NO injected root (absolute path never emitted)', () => {
    expect(computeStamp(`${ROOT}/src/App.tsx`, 42)).toBeUndefined();
  });

  it('fails closed for files OUTSIDE the root', () => {
    setProvenanceRoot(ROOT);
    expect(computeStamp('/somewhere/else/App.tsx', 3)).toBeUndefined();
    // Prefix that is not a path boundary must not match.
    expect(
      computeStamp('/home/dev/project-evil/src/App.tsx', 3),
    ).toBeUndefined();
  });

  it('filters node_modules', () => {
    setProvenanceRoot(ROOT);
    expect(
      computeStamp(`${ROOT}/node_modules/lib/index.js`, 1),
    ).toBeUndefined();
    expect(
      computeStamp(`${ROOT}/apps/web/node_modules/lib/x.jsx`, 1),
    ).toBeUndefined();
  });

  it('accepts Turbopack [project]/-prefixed names WITHOUT a root', () => {
    expect(computeStamp('[project]/examples/demo/app/page.tsx', 12)).toBe(
      'examples/demo/app/page.tsx:12',
    );
  });

  it('rejects hostile Turbopack-shaped names', () => {
    expect(computeStamp('[project]/../../etc/passwd.js', 1)).toBeUndefined();
    expect(computeStamp('[project]/.env:1', 1)).toBeUndefined();
    expect(
      computeStamp('[project]/node_modules/x/index.js', 1),
    ).toBeUndefined();
  });

  it('normalizes Windows separators', () => {
    setProvenanceRoot('C:/repo');
    expect(computeStamp('C:\\repo\\src\\App.tsx', 5)).toBe('src/App.tsx:5');
  });

  it('rejects bad line numbers', () => {
    setProvenanceRoot(ROOT);
    const file = `${ROOT}/src/App.tsx`;
    expect(computeStamp(file, 0)).toBeUndefined();
    expect(computeStamp(file, -1)).toBeUndefined();
    expect(computeStamp(file, 1.5)).toBeUndefined();
    expect(computeStamp(file, 10_000_000)).toBeUndefined();
    expect(computeStamp(file, '42')).toBeUndefined();
    expect(computeStamp(file, undefined)).toBeUndefined();
  });

  it('rejects non-string fileNames', () => {
    setProvenanceRoot(ROOT);
    expect(computeStamp(undefined, 1)).toBeUndefined();
    expect(computeStamp(null, 1)).toBeUndefined();
    expect(computeStamp(42, 1)).toBeUndefined();
    expect(computeStamp('', 1)).toBeUndefined();
  });

  it('NEVER emits a value starting with /, a drive letter, or ~ (pin)', () => {
    const hostile = [
      `${ROOT}/src/App.tsx`,
      '/etc/passwd.js',
      '~/x/App.tsx',
      'C:\\Users\\dev\\App.tsx',
      '[project]//etc/x.ts',
      `${ROOT}/../outside/App.tsx`,
    ];
    for (const withRoot of [true, false]) {
      setProvenanceRoot(withRoot ? ROOT : undefined);
      for (const fileName of hostile) {
        const stamp = computeStamp(fileName, 1);
        if (stamp !== undefined) {
          expect(stamp.startsWith('/')).toBe(false);
          expect(stamp.startsWith('~')).toBe(false);
          expect(/^[A-Za-z]:/.test(stamp)).toBe(false);
          expect(stamp).not.toContain('..');
        }
      }
    }
  });

  it('tolerates a trailing slash on the injected root', () => {
    setProvenanceRoot(`${ROOT}/`);
    expect(computeStamp(`${ROOT}/src/App.tsx`, 2)).toBe('src/App.tsx:2');
  });
});

describe('relativeSourceFile', () => {
  it('memoizes per root+fileName (root changes are respected)', () => {
    expect(relativeSourceFile(`${ROOT}/src/A.tsx`)).toBeUndefined();
    setProvenanceRoot(ROOT);
    expect(relativeSourceFile(`${ROOT}/src/A.tsx`)).toBe('src/A.tsx');
    setProvenanceRoot(undefined);
    expect(relativeSourceFile(`${ROOT}/src/A.tsx`)).toBeUndefined();
  });
});
