/**
 * The copy-paste embed snippet `patchback dev` prints and serves. The
 * apiKey here is the RUN-LOCAL dev key minted at boot (not a GitHub or
 * Anthropic secret): it exists so the widget submits at insider tier
 * against your own localhost API, and dies with the process.
 */
export interface SnippetOptions {
  apiUrl: string;
  apiKey: string;
}

export function buildWidgetSnippet(options: SnippetOptions): string {
  return [
    `<script src="${options.apiUrl}/widget.js"></script>`,
    '<script>',
    '  Patchback.create({',
    `    apiUrl: '${options.apiUrl}',`,
    `    apiKey: '${options.apiKey}', // dev-only key, minted per run`,
    '  });',
    '</script>',
  ].join('\n');
}
