import { describe, expect, it } from 'vitest';

import { scrubText } from './scrub.js';

/**
 * Fixture-driven scrub tests. All fixtures are OBVIOUSLY SYNTHETIC (zeros /
 * "test" padding) per repo hygiene — never real-looking keys.
 */
describe('scrubText', () => {
  it('redacts bearer tokens and authorization values', () => {
    expect(scrubText('sent Bearer abc.def-123 to api')).toBe(
      'sent Bearer [redacted] to api',
    );
    expect(scrubText('Authorization: tok_0000test')).toBe(
      'Authorization: [redacted]',
    );
  });

  it('redacts key-shaped literals', () => {
    expect(scrubText('key sk-000000000000000000000000test leaked')).toBe(
      'key [redacted-key] leaked',
    );
    expect(scrubText('ghp_00000000000000000000test in log')).toBe(
      '[redacted-key] in log',
    );
    expect(
      scrubText('github_pat_000000000000000000000000test here'),
    ).toBe('[redacted-key] here');
    expect(scrubText('aws AKIA0000000000000000 used')).toBe(
      'aws [redacted-key] used',
    );
    expect(scrubText('slack xoxb-0000-0000-testtoken done')).toBe(
      'slack [redacted-key] done',
    );
  });

  it('redacts JWTs', () => {
    expect(scrubText('jwt eyJ0est.eyJ0est.c2lnbmF0dXJl found')).toBe(
      'jwt [redacted-jwt] found',
    );
  });

  it('redacts emails', () => {
    expect(scrubText('mail me at first.last+tag@sub.example.co')).toBe(
      'mail me at [email]',
    );
  });

  it('redacts query strings inside URLs', () => {
    expect(
      scrubText('failed GET https://app.example.test/page?token=zzz&x=1 500'),
    ).toBe('failed GET https://app.example.test/page?[redacted] 500');
  });

  it('redacts long high-entropy blobs but leaves stack traces alone', () => {
    const blob = '0'.repeat(50);
    expect(scrubText(`payload ${blob} end`)).toBe(
      'payload [redacted-blob] end',
    );
    const stack =
      'TypeError: x is not a function\n    at handleClick (widget.js:10:5)';
    expect(scrubText(stack)).toBe(stack);
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The export button label says "Expot" instead of "Export".';
    expect(scrubText(prose)).toBe(prose);
  });
});
