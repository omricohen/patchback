/**
 * URL capture: origin + pathname ONLY by default — query strings carry
 * tokens/PII (`?token=…`, `?email=…`) and the hash can carry SPA state.
 * `includeQuery: true` opts the query back in; the hash is always dropped.
 */

export const URL_MAX_CHARS = 2000;

export function sanitizeUrl(
  href: string,
  options: { includeQuery?: boolean } = {},
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return undefined;
  }
  const query = options.includeQuery === true ? parsed.search : '';
  return `${parsed.origin}${parsed.pathname}${query}`.slice(0, URL_MAX_CHARS);
}
