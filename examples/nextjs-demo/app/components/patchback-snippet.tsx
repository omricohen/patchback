'use client';

/**
 * The embed snippet `patchback dev` prints, as a React client component.
 *
 * The printed snippet is two script tags:
 *
 *   <script src="http://127.0.0.1:8787/widget.js"></script>
 *   <script>
 *     Patchback.create({ apiUrl: '...', apiKey: '...' });
 *   </script>
 *
 * This component does exactly that — load `/widget.js` from the local
 * Patchback API and call `window.Patchback.create` — but reads the values
 * from env vars, because the insider dev key is minted PER RUN of
 * `patchback dev` (it is a session-local capability, not a user secret;
 * see the banner the CLI prints). Copy it from the banner into
 * `.env.local` (template: `.env.example`).
 *
 * Without a key the widget still works, but submissions land as
 * `outsider` tier — data only, never a patch job — so the demo loop
 * needs the key.
 */
import { useEffect, useState } from 'react';

interface PatchbackGlobal {
  create(config: { apiUrl: string; apiKey?: string }): { destroy(): void };
}

declare global {
  interface Window {
    Patchback?: PatchbackGlobal;
  }
}

const API_URL =
  process.env.NEXT_PUBLIC_PATCHBACK_API_URL ?? 'http://127.0.0.1:8787';
const API_KEY = process.env.NEXT_PUBLIC_PATCHBACK_API_KEY;

export function PatchbackSnippet() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (API_KEY === undefined || API_KEY === '') {
      return;
    }
    let widget: { destroy(): void } | undefined;
    const script = document.createElement('script');
    script.src = `${API_URL}/widget.js`;
    script.onload = () => {
      widget = window.Patchback?.create({ apiUrl: API_URL, apiKey: API_KEY });
    };
    script.onerror = () => {
      setError(
        `Could not load ${API_URL}/widget.js — is \`patchback dev\` running?`,
      );
    };
    document.body.appendChild(script);
    return () => {
      widget?.destroy();
      script.remove();
    };
  }, []);

  if (API_KEY === undefined || API_KEY === '') {
    return (
      <p className="patchback-setup-note" role="note">
        Patchback is not wired up yet: run <code>patchback dev</code>, copy the
        insider dev key from its banner into{' '}
        <code>examples/nextjs-demo/.env.local</code> (see{' '}
        <code>.env.example</code>), then restart <code>next dev</code>.
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="patchback-setup-note" role="note">
        {error}
      </p>
    );
  }
  return null;
}
