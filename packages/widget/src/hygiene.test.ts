import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * No-telemetry / dependency-confinement drift alarms.
 *
 * Over the SOURCE tree (always enforced, build-independent):
 * 1. No `http(s)://` string literals anywhere in widget source — the widget
 *    talks exclusively to the configured apiUrl; no CDN assets, no beacons.
 * 2. snapdom is imported by exactly ONE file (the renderer adapter) and
 *    only via dynamic `import()` — the core stays zero-dep and lazy.
 * 3. `navigator.sendBeacon` appears nowhere.
 *
 * Over the SHIPPED IIFE BUNDLE (enforced whenever dist exists — always in
 * the CI browser job, which builds first; skipped with a notice on
 * test-before-build runs): every http(s) origin in the bundle must be on
 * the explicit allowlist below, and the icon-font suppression override
 * must be present. The bundle inlines snapdom, whose vendored code
 * carries: XML namespace constants (w3.org — never fetched), localhost
 * URL-resolution fallbacks (never fetched as such), and four Material
 * Icons woff2 URLs on fonts.gstatic.com — fetchable in ONE edge case,
 * which the adapter disables at runtime via __SNAPDOM_ICON_FONTS__ before
 * the module evaluates. Any origin outside this list is a new phone-home
 * risk and fails the suite.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const IIFE_BUNDLE = join(SRC, '..', 'dist', 'patchback-widget.iife.js');

const BUNDLE_ALLOWED_ORIGINS = new Set([
  'http://www.w3.org', // XML/SVG namespace identifiers, never fetched.
  'http://localhost', // snapdom's URL-resolution base fallback, never fetched.
  'https://fonts.gstatic.com', // snapdom icon-font constants — disabled at runtime (see below).
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('widget hygiene', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no http(s):// literals (no CDN, no beacons, no hardcoded hosts)', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Strip comments before scanning — prose may mention URLs.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code, `http(s):// literal in ${file}`).not.toMatch(/https?:\/\//);
    }
  });

  it('never calls navigator.sendBeacon', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain('sendBeacon');
    }
  });

  it('confines snapdom to the one adapter file, dynamic-import only', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const mentions = text.includes('@zumer/snapdom');
      if (file.endsWith('screenshot-snapdom.ts')) {
        expect(mentions).toBe(true);
        // Dynamic import only — never a static `import ... from`.
        expect(text).toMatch(/await import\(['"]@zumer\/snapdom['"]\)/);
        expect(text).not.toMatch(/^import[^;]*['"]@zumer\/snapdom['"]/m);
      } else {
        expect(mentions, `unexpected snapdom reference in ${file}`).toBe(false);
      }
    }
  });

  it('the adapter suppresses snapdom icon-font fetches BEFORE the module loads', () => {
    const adapter = readFileSync(
      join(SRC, 'capture', 'screenshot-snapdom.ts'),
      'utf8',
    );
    expect(adapter).toContain('__SNAPDOM_ICON_FONTS__');
    // The override must be installed before the dynamic import (module
    // evaluation reads the global exactly once).
    const overrideIndex = adapter.indexOf('suppressVendorIconFontFetches()');
    const importIndex = adapter.indexOf("await import('@zumer/snapdom')");
    expect(overrideIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeLessThan(importIndex);
  });

  const bundleBuilt = existsSync(IIFE_BUNDLE);

  it.skipIf(!bundleBuilt)(
    'shipped IIFE bundle: every http(s) origin is on the allowlist and the suppression shipped',
    () => {
      const bundle = readFileSync(IIFE_BUNDLE, 'utf8');
      const origins = new Set(bundle.match(/https?:\/\/[a-zA-Z0-9.-]+/g) ?? []);
      for (const origin of origins) {
        expect(
          BUNDLE_ALLOWED_ORIGINS.has(origin),
          `bundle contains non-allowlisted origin ${origin} — new phone-home risk`,
        ).toBe(true);
      }
      // The gstatic constants only remain acceptable because the runtime
      // suppression ships in the same bundle.
      if (origins.has('https://fonts.gstatic.com')) {
        expect(bundle).toContain('__SNAPDOM_ICON_FONTS__');
        expect(bundle).toContain('materialIconsFilled');
      }
      expect(bundle).not.toContain('sendBeacon');
    },
  );

  it.skipIf(bundleBuilt)(
    'NOTE: IIFE bundle scan skipped — dist/patchback-widget.iife.js not built yet (run pnpm build)',
    () => {
      // Placeholder so the skip is visible in output when dist is absent.
    },
  );
});
