import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * No-telemetry / dependency-confinement drift alarms, enforced over the
 * SOURCE tree (build-independent):
 *
 * 1. No `http(s)://` string literals anywhere in widget source — the widget
 *    talks exclusively to the configured apiUrl; no CDN assets, no beacons.
 * 2. snapdom is imported by exactly ONE file (the renderer adapter) and
 *    only via dynamic `import()` — the core stays zero-dep and lazy.
 * 3. `navigator.sendBeacon` appears nowhere.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

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
      expect(code, `http(s):// literal in ${file}`).not.toMatch(
        /https?:\/\//,
      );
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
        expect(mentions, `unexpected snapdom reference in ${file}`).toBe(
          false,
        );
      }
    }
  });
});
