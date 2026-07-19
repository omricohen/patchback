/**
 * Build-time source provenance — the shared contract between the build
 * integration (`@patchback/provenance`), the widget, the API, and the brief
 * factory.
 *
 * Trust boundary: the provenance attribute lives in the page DOM, so its
 * value is app/submitter-controlled data. Anything that consumes it MUST
 * validate through {@link parseSourceHint} before letting it near an agent.
 */

/**
 * DOM attribute carrying a build-time source annotation on host elements:
 * `data-pb-source="relative/path/from/repo/root.tsx:LINE"`.
 *
 * This is a public contract, not a plugin implementation detail — any
 * framework or app may stamp it by hand (that is the story for vanilla /
 * non-JSX apps). A manually authored attribute wins over the runtime stamp.
 */
export const PROVENANCE_ATTRIBUTE = 'data-pb-source';

/** Hard cap on a source-hint string, enforced at every layer. */
export const SOURCE_HINT_MAX_LENGTH = 512;

/**
 * Extensions a source hint may reference. Anything else (configs, env files,
 * lockfiles, workflows…) is rejected at the shape level.
 */
export const SOURCE_HINT_EXTENSIONS: readonly string[] = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'vue',
  'svelte',
  'astro',
  'mdx',
];

const EXTENSIONS = new Set(SOURCE_HINT_EXTENSIONS);

/** Result of successfully parsing a source hint. */
export interface ParsedSourceHint {
  /** Repo-root-relative file path, forward slashes, validated charset. */
  file: string;
  /** 1-based line number. */
  line: number;
}

/** Printable ASCII only — no whitespace, control chars, or unicode. */
const PRINTABLE_ASCII = /^[!-~]+$/;
/** One path segment: letters, digits, `_`, `.`, `-`. Never empty. */
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
/** 1-based line/column: 1–7 digits, no leading zero. */
const LINE = /^[1-9][0-9]{0,6}$/;

/**
 * Validate and parse a `file:line[:col]` source hint. Returns `undefined`
 * for ANYTHING that is not a clean, relative, repo-shaped path — this is the
 * single source of truth used by the widget, the API tests, and the brief
 * factory (the authoritative gate).
 *
 * Rejected by construction: absolute paths (`/…`, `C:\…`, `~…`), traversal
 * (`.`/`..`), ALL dot-prefixed segments (`.env`, `.git/…`, `.github/…`),
 * `node_modules` anywhere, backslashes, URLs, whitespace/control chars,
 * non-ASCII, missing/disallowed extensions, missing or zero line numbers,
 * and anything over {@link SOURCE_HINT_MAX_LENGTH} chars. Prompt-injection
 * prose physically cannot pass (no spaces, no quotes/backticks in the
 * charset, `:` only as the line/col separator).
 */
export function parseSourceHint(raw: unknown): ParsedSourceHint | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  if (raw.length === 0 || raw.length > SOURCE_HINT_MAX_LENGTH) {
    return undefined;
  }
  if (!PRINTABLE_ASCII.test(raw)) {
    return undefined;
  }
  const parts = raw.split(':');
  // file:line, tolerating (and discarding) a trailing :col.
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }
  const file = parts[0] as string;
  const lineRaw = parts[1] as string;
  const colRaw = parts[2];
  if (!LINE.test(lineRaw)) {
    return undefined;
  }
  if (colRaw !== undefined && !LINE.test(colRaw)) {
    return undefined;
  }
  const segments = file.split('/');
  for (const segment of segments) {
    // Empty segment ⇒ leading `/`, trailing `/`, or `//` — all rejected.
    if (!SEGMENT.test(segment)) {
      return undefined;
    }
    // No `.`/`..` traversal and no dot-prefixed segments at all: blocks
    // `.env`, `.git/*`, `.github/*` at the shape level.
    if (segment.startsWith('.')) {
      return undefined;
    }
    if (segment === 'node_modules') {
      return undefined;
    }
  }
  const basename = segments[segments.length - 1] as string;
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) {
    return undefined;
  }
  const extension = basename.slice(dot + 1).toLowerCase();
  if (!EXTENSIONS.has(extension)) {
    return undefined;
  }
  return { file, line: Number(lineRaw) };
}

/** Type-guard convenience over {@link parseSourceHint}. */
export function isValidSourceHint(raw: unknown): raw is string {
  return parseSourceHint(raw) !== undefined;
}

/** Canonical `file:line` form (column, if any, has been discarded). */
export function formatSourceHint(hint: ParsedSourceHint): string {
  return `${hint.file}:${hint.line}`;
}
