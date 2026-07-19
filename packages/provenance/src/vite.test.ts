import { describe, expect, it } from 'vitest';

import { PROVENANCE_ROOT_GLOBAL } from './core.js';
import { patchbackProvenance } from './vite.js';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(
  /\/$/,
  '',
);

interface HtmlTag {
  tag: string;
  children?: string;
  injectTo?: string;
}

/** Call the plugin's hooks the way Vite would (they are plain functions). */
function hooks(plugin: ReturnType<typeof patchbackProvenance>): {
  config: (
    config: Record<string, unknown>,
    env: { command: string; mode: string },
  ) => Record<string, unknown> | undefined;
  transformIndexHtml: () => HtmlTag[] | undefined;
  transform: (code: string, id: string) => Promise<{ code: string } | null>;
} {
  return plugin as unknown as ReturnType<typeof hooks>;
}

describe('vite plugin', () => {
  it('dev: sets jsxImportSource and injects the discovered repo root', () => {
    const plugin = hooks(patchbackProvenance());
    const config = plugin.config({}, { command: 'serve', mode: 'development' });
    // Against Vite ≥8 (this repo) the oxc option carries the import source;
    // on older Vite the esbuild option would instead.
    expect(config).toEqual({
      oxc: { jsx: { importSource: '@patchback/provenance' } },
    });
    const tags = plugin.transformIndexHtml();
    expect(tags).toHaveLength(1);
    const tag = (tags as HtmlTag[])[0] as HtmlTag;
    expect(tag.tag).toBe('script');
    expect(tag.injectTo).toBe('head-prepend');
    // Discovered root = this repo (nearest .git ancestor of cwd).
    expect(tag.children).toContain(PROVENANCE_ROOT_GLOBAL);
    expect(tag.children).toContain(JSON.stringify(REPO_ROOT));
  });

  it('dev: root option overrides discovery', () => {
    const plugin = hooks(patchbackProvenance({ root: '/custom/root' }));
    plugin.config({}, { command: 'serve', mode: 'development' });
    const tags = plugin.transformIndexHtml();
    expect((tags as HtmlTag[])[0]?.children).toContain('"/custom/root"');
  });

  it('build: inert by default — no import source, no html tag, no transform', async () => {
    const plugin = hooks(patchbackProvenance());
    const config = plugin.config({}, { command: 'build', mode: 'production' });
    expect(config).toEqual({});
    expect(plugin.transformIndexHtml()).toBeUndefined();
    expect(
      await plugin.transform('export const x = <div>d</div>;', '/repo/x.tsx'),
    ).toBeNull();
  });

  it('build with production: "annotate" statically stamps host elements', async () => {
    const plugin = hooks(
      patchbackProvenance({ root: '/repo', production: 'annotate' }),
    );
    plugin.config({}, { command: 'build', mode: 'production' });
    const result = await plugin.transform(
      'export const x = <button>b</button>;',
      '/repo/src/x.tsx',
    );
    expect(result?.code).toContain('data-pb-source="src/x.tsx:1"');
  });

  it('build annotate skips node_modules and non-JSX files', async () => {
    const plugin = hooks(
      patchbackProvenance({ root: '/repo', production: 'annotate' }),
    );
    plugin.config({}, { command: 'build', mode: 'production' });
    expect(
      await plugin.transform(
        'export const x = <div>d</div>;',
        '/repo/node_modules/lib/x.tsx',
      ),
    ).toBeNull();
    expect(
      await plugin.transform('const x = 1;', '/repo/src/x.css'),
    ).toBeNull();
  });

  it('dev: transform never annotates (runtime mechanism owns dev)', async () => {
    const plugin = hooks(
      patchbackProvenance({ root: '/repo', production: 'annotate' }),
    );
    plugin.config({}, { command: 'serve', mode: 'development' });
    expect(
      await plugin.transform(
        'export const x = <div>d</div>;',
        '/repo/src/x.tsx',
      ),
    ).toBeNull();
  });
});
