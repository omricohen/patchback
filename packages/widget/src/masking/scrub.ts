/**
 * Text scrubbing for CAPTURED text (element text, console entries, page
 * titles) — never the user's deliberately typed message. Applied at
 * capture/insert time so secrets never sit in widget memory either.
 *
 * Best-effort defense in depth: the primary control is that capture is
 * opt-in and user-previewed; this narrows what an accidental capture can
 * leak. Ordered passes — each replaces with a typed placeholder.
 */

interface ScrubPass {
  pattern: RegExp;
  replacement: string;
}

const PASSES: readonly ScrubPass[] = [
  // Authorization header values / bearer tokens.
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: 'Bearer [redacted]',
  },
  {
    pattern: /\b(authorization\s*[:=]\s*)("?)[^\s"',;]+\2/gi,
    replacement: '$1[redacted]',
  },
  // Key-shaped literals: model-provider keys, GitHub tokens, AWS access
  // keys, Slack tokens.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: '[redacted-key]' },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replacement: '[redacted-key]',
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[redacted-key]',
  },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted-key]' },
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
    replacement: '[redacted-key]',
  },
  // JWTs: three base64url segments starting with eyJ.
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: '[redacted-jwt]',
  },
  // Emails — the "emails" in "masking (inputs, emails, selectors)".
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g,
    replacement: '[email]',
  },
  // Query strings inside URLs appearing in messages/stack frames.
  {
    pattern: /(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g,
    replacement: '$1?[redacted]',
  },
  // Long high-entropy blobs (base64/hex ≥ 40 chars). Deliberately LAST and
  // conservative so it never eats normal words or stack traces.
  {
    pattern: /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_-])/g,
    replacement: '[redacted-blob]',
  },
];

export function scrubText(text: string): string {
  let out = text;
  for (const pass of PASSES) {
    out = out.replace(pass.pattern, pass.replacement);
  }
  return out;
}
