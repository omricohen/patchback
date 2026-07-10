import { describe, expect, it } from 'vitest';

import { parseCliOutput } from './result.js';

describe('parseCliOutput', () => {
  it('parses a successful result object', () => {
    const parsed = parseCliOutput(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done: changed the label.',
      }),
    );
    expect(parsed).toEqual({
      resultText: 'Done: changed the label.',
      isError: false,
      structured: true,
    });
  });

  it('flags is_error results', () => {
    const parsed = parseCliOutput(
      JSON.stringify({ is_error: true, result: 'I failed.' }),
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.resultText).toBe('I failed.');
  });

  it('flags error subtypes even without is_error', () => {
    const parsed = parseCliOutput(
      JSON.stringify({ subtype: 'error_max_turns', result: 'ran out' }),
    );
    expect(parsed.isError).toBe(true);
  });

  it('recovers the JSON object from a trailing line after log noise', () => {
    const stdout = `warming up...\n${JSON.stringify({ result: 'ok', is_error: false })}\n`;
    const parsed = parseCliOutput(stdout);
    expect(parsed.structured).toBe(true);
    expect(parsed.resultText).toBe('ok');
  });

  it('degrades to raw text for non-JSON output', () => {
    const parsed = parseCliOutput('plain text, definitely not JSON');
    expect(parsed).toEqual({
      resultText: 'plain text, definitely not JSON',
      isError: false,
      structured: false,
    });
  });

  it('treats JSON arrays/primitives as unstructured', () => {
    expect(parseCliOutput('[1,2,3]').structured).toBe(false);
    expect(parseCliOutput('42').structured).toBe(false);
  });

  it('falls back to the raw text when result is not a string', () => {
    const raw = JSON.stringify({ result: 7, is_error: false });
    expect(parseCliOutput(raw).resultText).toBe(raw);
  });
});
